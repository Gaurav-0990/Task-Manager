const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createUser, findUserByEmail, updateUserOtp, markUserVerified, ensureUserState } = require('../db');
const { signToken } = require('../middleware/auth');

const router = express.Router();
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 10 * 60 * 1000);

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email, otp) {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.log(`[OTP] ${email}: ${otp}`);
    return { mode: 'console' };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@thesystem.local',
    to: email,
    subject: 'Your THE SYSTEM verification code',
    text: `Your verification code is ${otp}`,
  });
  return { mode: 'smtp' };
}

// Generates a plaintext OTP for the email, but only ever persists its bcrypt
// hash — so a DB leak doesn't hand out live verification codes.
async function issueOtp(email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const otpExpiresAt = Date.now() + OTP_TTL_MS;
  await updateUserOtp(normalizedEmail, otpHash, otpExpiresAt);
  await sendOtpEmail(normalizedEmail, otp);
  return { otpExpiresAt };
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing && existing.verified) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = 'u' + Date.now() + Math.random().toString(36).slice(2, 8);
    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = Date.now() + OTP_TTL_MS;
    await createUser({
      id,
      email: normalizedEmail,
      passwordHash,
      createdAt: Date.now(),
      verified: false,
      otpHash,
      otpExpiresAt,
    });
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(201).json({
      message: 'Verification code sent to your email',
      requiresVerification: true,
      email: normalizedEmail,
    });
  } catch (err) {
    console.error('register failed', err);
    next(err);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body || {};
    if (!validateEmail(email) || typeof otp !== 'string' || otp.trim().length !== 6) {
      return res.status(400).json({ error: 'Valid email and 6-digit OTP required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) {
      const token = signToken(user.id);
      return res.json({ token, userId: user.id, verified: true });
    }

    if (!user.otpHash || Date.now() > (user.otpExpiresAt || 0)) {
      await issueOtp(normalizedEmail);
      return res.status(401).json({ error: 'OTP expired. A new code has been sent.', requiresVerification: true });
    }

    const match = await bcrypt.compare(otp.trim(), user.otpHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    await markUserVerified(normalizedEmail);
    await ensureUserState(user.id);
    const token = signToken(user.id);
    return res.json({ token, userId: user.id, verified: true });
  } catch (err) {
    console.error('verify otp failed', err);
    next(err);
  }
});

router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await issueOtp(normalizedEmail);
    return res.json({ message: 'A new verification code has been sent', requiresVerification: true, email: normalizedEmail });
  } catch (err) {
    console.error('resend otp failed', err);
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 1) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);

    // Check the password before revealing anything about verification
    // status, so a wrong-password guess and a nonexistent email both come
    // back as the same generic error — you can't use this to probe which
    // emails are registered.
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.verified) {
      await issueOtp(normalizedEmail);
      return res.status(403).json({ error: 'Email not verified. A verification code has been sent.', requiresVerification: true, email: normalizedEmail });
    }

    const token = signToken(user.id);
    return res.json({ token, userId: user.id });
  } catch (err) {
    console.error('login failed', err);
    next(err);
  }
});

module.exports = router;
