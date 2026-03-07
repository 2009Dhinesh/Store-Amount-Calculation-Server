const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretstorebudgetappkey', {
    expiresIn: '30d',
  });
};

const nodemailer = require('nodemailer');

const signupUser = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        groupId: user.groupId,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    console.log(`Starting OTP flow for email: ${email}`);
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`User not found: ${email}`);
      return res.status(404).json({ message: 'No account found with this email' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
    
    try {
      await user.save();
      console.log('OTP saved to database');
    } catch (saveError) {
      console.error('Database Save Error:', saveError);
      return res.status(500).json({ message: 'Database Error: Could not save OTP' });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('Missing SMTP Environment Variables!');
      return res.status(500).json({ 
        message: 'Backend Configuration Error: SMTP_USER or SMTP_PASS not found in Render Environment Variables.' 
      });
    }

    // Reverting to Nodemailer but using Port 2525 (Alternative SMTP port that Render doesn't block)
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 2525, 
      secure: false, 
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Store Budget" <${process.env.SENDER_EMAIL}>`,
      to: user.email,
      subject: 'Store Budget - Password Reset OTP',
      text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`,
      html: `<h3>Store Budget Password Reset</h3><p>Your OTP is: <b>${otp}</b></p><p>It is valid for 10 minutes.</p>`
    };

    console.log(`Attempting to send OTP via Port 2525 to: ${user.email}`);
    await transporter.sendMail(mailOptions);
    console.log(`OTP successfully sent to: ${user.email}`);
    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Full Email Error Object:', error);
    
    let userMessage = `Email Sending Failed (${error.code || 'UNKNOWN'})`;
    if (error.code === 'EAUTH') {
      userMessage = 'Email Auth Failed: Your SMTP_PASS (Brevo Key) is incorrect.';
    } else if (error.code === 'ETIMEDOUT') {
      userMessage = 'Connection Timeout: The email server is taking too long to respond on Port 2525.';
    } else if (error.code === 'ESOCKET' || error.syscall === 'connect') {
      userMessage = `Network Error: Backend could not connect to Brevo on Port 2525 (${error.syscall || 'connect'}).`;
    }

    res.status(500).json({ 
      message: userMessage,
      error: error.message,
      code: error.code
    });
  }
};

const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await User.findOne({
      email,
      resetPasswordOtp: otp,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired OTP' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (user) {
      const Group = require('../models/Group');
      const ledGroupsCount = await Group.countDocuments({ groupLeader: user._id });
      const memberGroupsCount = await Group.countDocuments({ members: user._id });
      
      const userObj = { ...user };
      userObj.isLeader = ledGroupsCount > 0;
      userObj.isInGroup = (ledGroupsCount > 0 || memberGroupsCount > 0);
      
      res.json(userObj);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password').lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { signupUser, loginUser, getUserProfile, getAllUsers, forgotPassword, resetPassword };
