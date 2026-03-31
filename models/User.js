const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  paymentStatus: {
    type: String,
    default: 'pending',
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  },
  amount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Amount',
  },
  totalExpense: {
    type: Number,
    default: 0,
  },
  resetPasswordOtp: {
    type: String,
  },
  resetPasswordExpires: {
    type: Date,
  },
  monthlyLimit: {
    type: Number,
    default: 0,
  },
  notificationsEnabled: {
    type: Boolean,
    default: true,
  },
  notificationThreshold: {
    type: Number,
    default: 80,
  },
  expoPushToken: {
    type: String,
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
