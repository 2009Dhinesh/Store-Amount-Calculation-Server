const mongoose = require('mongoose');
const Amount = require('../models/Amount');
const User = require('../models/User');
const Group = require('../models/Group');
const History = require('../models/History');

// Helper to recalculate and update user's totalExpense
// Helper to recalculate and update user's totalExpense using MongoDB aggregation (High Performance)
const syncUserTotal = async (userId) => {
  if (!userId) return;
  const result = await Amount.aggregate([
    { $match: { 'memberShares.user': new mongoose.Types.ObjectId(userId) } },
    { $unwind: '$memberShares' },
    { $match: { 'memberShares.user': new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, total: { $sum: '$memberShares.amount' } } }
  ]);
  const total = result.length > 0 ? result[0].total : 0;
  await User.findByIdAndUpdate(userId, { totalExpense: total });
};

// Helper to recalculate and update group's totalAmount
// Helper to recalculate and update group's totalAmount using aggregation
const syncGroupTotal = async (groupId) => {
  if (!groupId) return;
  const result = await Amount.aggregate([
    { $match: { groupId: new mongoose.Types.ObjectId(groupId) } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const total = result.length > 0 ? result[0].total : 0;
  await Group.findByIdAndUpdate(groupId, { totalAmount: total });
};

const addAmount = async (req, res) => {
  try {
    const { title, amount, category, totalPersons, persons, totalAmount, memberShares, groupId } = req.body;
    
    const newAmount = new Amount({
      createdBy: req.user.id,
      groupId: groupId || null,
      title,
      amount,
      category,
      totalPersons,
      persons,
      totalAmount: totalAmount || amount,
      memberShares: memberShares || [],
      isPaid: false,
    });

    const createdAmount = await newAmount.save();

    // Recalculate totals for all involved members
    if (memberShares && memberShares.length > 0) {
      const syncs = memberShares.map(share => syncUserTotal(share.user));
      await Promise.all(syncs);
    }

    // Recalculate group total
    if (groupId) {
      await syncGroupTotal(groupId);
      
      // Log History
      await History.create({
        groupId,
        userId: req.user.id,
        type: 'ADD',
        amount: amount,
        title: title
      });
    }

    res.status(201).json(createdAmount);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAmounts = async (req, res) => {
  try {
    // Basic logic: get amounts created by user or where user is a person involved
    const amounts = await Amount.find({
      $or: [
        { createdBy: req.user.id },
        { 'memberShares.user': req.user.id }
      ]
    })
    .select('title amount category dateTime createdBy memberShares isPaid totalAmount')
    .populate('createdBy', 'name')
    .populate('memberShares.user', 'name')
    .sort({ dateTime: -1 })
    .lean();
    res.json(amounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAmountDetails = async (req, res) => {
  try {
    const amount = await Amount.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('memberShares.user', 'name')
      .lean();
    if (!amount) return res.status(404).json({ message: 'Amount not found' });
    res.json(amount);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const editAmount = async (req, res) => {
  try {
    const amount = await Amount.findById(req.params.id);
    if (!amount) return res.status(404).json({ message: 'Amount not found' });

    if (amount.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Capture old memberShares and groupId for recalculation
    const oldMemberShares = amount.memberShares ? amount.memberShares.map(s => s.user) : [];
    const oldGroupId = amount.groupId;

    amount.title = req.body.title || amount.title;
    amount.amount = req.body.amount || amount.amount;
    amount.category = req.body.category || amount.category;
    amount.totalPersons = req.body.totalPersons || amount.totalPersons;
    amount.persons = req.body.persons || amount.persons;
    amount.totalAmount = req.body.totalAmount || amount.totalAmount;
    amount.memberShares = req.body.memberShares || amount.memberShares;
    amount.groupId = req.body.groupId || amount.groupId;

    const updatedAmount = await amount.save();
    
    // Recalculate totals after edit
    const newMemberShares = updatedAmount.memberShares ? updatedAmount.memberShares.map(s => s.user) : [];
    const allAffectedUsers = [...new Set([...oldMemberShares, ...newMemberShares])];

    await Promise.all(allAffectedUsers.map(s => syncUserTotal(s)));
    
    if (oldGroupId || updatedAmount.groupId) {
        await Promise.all([syncGroupTotal(oldGroupId), syncGroupTotal(updatedAmount.groupId)]);
    }

    res.json(updatedAmount);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteAmount = async (req, res) => {
  try {
    const amount = await Amount.findById(req.params.id);
    if (!amount) return res.status(404).json({ message: 'Amount not found' });

    if (amount.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Capture affected group and users before deletion
    const affectedGroupId = amount.groupId;
    const affectedUserIds = (amount.memberShares || []).map(s => s.user);

    await amount.deleteOne();

    // Recalculate totals after deletion
    const userSyncs = affectedUserIds.map(uid => syncUserTotal(uid));
    await Promise.all([...userSyncs, syncGroupTotal(affectedGroupId)]);

    // Log History
    if (affectedGroupId) {
      await History.create({
        groupId: affectedGroupId,
        userId: req.user.id,
        type: 'DELETE',
        amount: amount.amount,
        title: amount.title
      });
    }

    res.json({ message: 'Amount removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const markAsPaid = async (req, res) => {
  try {
    const amount = await Amount.findById(req.params.id);
    if (!amount) return res.status(404).json({ message: 'Amount not found' });

    if (amount.createdBy.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Only the creator can mark as paid' });
    }

    amount.isPaid = true;
    await amount.save();
    res.json({ message: 'Marked as paid', isPaid: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { addAmount, getAmounts, getAmountDetails, editAmount, deleteAmount, markAsPaid, syncUserTotal, syncGroupTotal };
