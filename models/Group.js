const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  groupLeader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  totalAmount: {
    type: Number,
    default: 0,
  },
  monthlyLimit: {
    type: Number,
    default: 0,
  },
  notificationThreshold: {
    type: Number,
    default: 80,
  }
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);
