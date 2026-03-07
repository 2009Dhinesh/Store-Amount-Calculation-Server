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

    // Use Port 2525 - The industry standard for bypassing SMTP blocks on Cloud platforms (Render/Heroku/Vercel)
    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 2525,
      secure: false, // STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 20000, // 20 seconds
      socketTimeout: 30000,
    });

    const mailOptions = {
      from: `"Store Budget Support" <${process.env.SENDER_EMAIL}>`,
      to: user.email,
      subject: 'Store Budget - Password Reset OTP',
      text: `Your Store Budget OTP is: ${otp}. It is valid for 10 minutes. If you did not request this, please ignore this email.`,
      html: `
        <div style="font-family: 'Inter', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; border: 1px solid #f0f0f0; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #007AFF; font-size: 28px; font-weight: 800; margin: 0;">Store Budget</h2>
            <p style="color: #666666; font-size: 14px; margin-top: 8px;">Your Finances, Simplified</p>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 12px; text-align: center;">
            <p style="color: #333333; font-size: 16px; margin-bottom: 20px;">We received a request to reset your password. Use the following code to continue:</p>
            
            <div style="display: inline-block; padding: 16px 32px; background-color: #007AFF; border-radius: 8px; font-size: 32px; font-weight: 800; color: #ffffff; letter-spacing: 4px;">
              ${otp}
            </div>
            
            <p style="color: #888888; font-size: 13px; margin-top: 25px;">This OTP is valid for <b>10 minutes</b>.</p>
          </div>
          
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eeeeee; text-align: center;">
            <p style="color: #999999; font-size: 12px; line-height: 1.5;">
              If you didn't request this code, you can safely ignore this email. Another user might have entered your email address by mistake.
            </p>
            <p style="color: #999999; font-size: 12px; margin-top: 20px; font-weight: 600;">© 2026 Store Budget Team</p>
          </div>
        </div>
      `
    };

    console.log(`[Email Debug] Target: ${user.email} | Using Host: smtp-relay.brevo.com | Port: 2525`);
    await transporter.sendMail(mailOptions);
    console.log(`[Email Debug] OTP successfully sent to: ${user.email}`);
    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    console.error('[Email Logic Error]:', error);
    
    let userMessage = `Email Sending Failed (${error.code || 'UNKNOWN'})`;
    
    // Categorize errors specifically for the User/Render
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      userMessage = 'Email Auth Failed: Your SMTP_PASS (Brevo API/SMTP Key) is incorrect on Render.';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      userMessage = 'Network Timeout: Brevo server is slow. Please try again.';
    } else if (error.code === 'ESOCKET' || error.syscall === 'connect') {
      userMessage = `Network Blocked: Render cannot connect to Brevo on Port 2525 (${error.syscall || 'connect'}).`;
    }

    res.status(500).json({ 
      message: userMessage,
      error: error.message,
      code: error.code,
      details: 'Check Render Environment Variables: SMTP_USER, SMTP_PASS, SENDER_EMAIL'
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
