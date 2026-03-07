const mongoose = require('mongoose');

const amountSchema = new mongoose.Schema({
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
  },
  title: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  totalPersons: {
    type: Number,
    required: true,
  },
  persons: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  memberShares: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number }
  }],
  isPaid: {
    type: Boolean,
    default: false,
  },
  dateTime: {
    type: Date,
    default: Date.now,
  },
  totalAmount: {
    type: Number,
    required: true,
  }
}, { timestamps: true });

amountSchema.index({ createdBy: 1, dateTime: -1 });
amountSchema.index({ groupId: 1, dateTime: -1 });
amountSchema.index({ 'memberShares.user': 1 });

module.exports = mongoose.model('Amount', amountSchema);
