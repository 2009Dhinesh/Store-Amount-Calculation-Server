const mongoose = require('mongoose');
const Amount = require('../models/Amount');
const User = require('../models/User');
const Group = require('../models/Group');
const History = require('../models/History');
const { sendPushNotifications } = require('../services/pushNotificationService');

// Helper to notify group leader of member actions
const notifyGroupLeader = async (groupId, performerId, action, data) => {
  try {
    const group = await Group.findById(groupId).populate('groupLeader', 'name expoPushToken notificationsEnabled');
    if (!group || !group.groupLeader) return;

    const leader = group.groupLeader;
    // Don't notify if the performer is the leader themselves OR if leader has tokens disabled
    if (leader._id.toString() === performerId.toString()) return;
    if (!leader.expoPushToken || leader.notificationsEnabled === false) return;

    const performer = await User.findById(performerId).select('name');
    const performerName = performer ? performer.name : 'A member';

    let title = '';
    let body = '';

    switch (action) {
      case 'ADD':
        title = 'New Transaction 📝';
        body = `${performerName} added ₹${data.amount} for ${data.category} in "${group.name}".`;
        break;
      case 'EDIT':
        title = 'Transaction Updated ✏️';
        body = `${performerName} updated "${data.title}" to ₹${data.amount} in "${group.name}".`;
        break;
      case 'DELETE':
        title = 'Transaction Deleted 🗑️';
        body = `${performerName} removed "${data.title}" from "${group.name}".`;
        break;
    }

    if (title && body) {
      await sendPushNotifications([leader.expoPushToken], {
        title,
        body,
        data: { groupId, type: action }
      });
    }
  } catch (error) {
    console.error('Failed to notify group leader:', error);
  }
};

// Helper to recalculate and update user's totalExpense using aggregation
const syncUserTotal = async (userId) => {
  if (!userId) return;
  const result = await Amount.aggregate([
    { $match: { 'memberShares.user': new mongoose.Types.ObjectId(userId) } },
    { $unwind: '$memberShares' },
    { $match: { 
        'memberShares.user': new mongoose.Types.ObjectId(userId),
        'memberShares.isSettled': { $ne: true } 
      } 
    },
    { $group: { _id: null, total: { $sum: '$memberShares.amount' } } }
  ]);
  const total = result.length > 0 ? result[0].total : 0;
  await User.findByIdAndUpdate(userId, { totalExpense: total });
};

// Helper to recalculate and update group's totalAmount using aggregation
const syncGroupTotal = async (groupId) => {
  if (!groupId) return;
  const result = await Amount.aggregate([
    { $match: { 
        groupId: new mongoose.Types.ObjectId(groupId),
        isSettled: { $ne: true }
      } 
    },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const total = result.length > 0 ? result[0].total : 0;
  await Group.findByIdAndUpdate(groupId, { totalAmount: total });
};

const addAmount = async (req, res) => {
  try {
    const { title, amount, category, totalPersons, persons, totalAmount, memberShares, groupId, dateTime } = req.body;
    
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
      isSettled: false,
      dateTime: dateTime || new Date()
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

      // Notify Leader
      await notifyGroupLeader(groupId, req.user.id, 'ADD', { amount, category });
    }

    res.status(201).json(createdAmount);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAmounts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    const userGroups = await Group.find({
      $or: [
        { groupLeader: req.user.id },
        { members: req.user.id }
      ]
    }).select('_id');
    const groupIds = userGroups.map(g => g._id);

    let query = Amount.find({
      $or: [
        { createdBy: req.user.id },
        { 'memberShares.user': req.user.id },
        { groupId: { $in: groupIds } }
      ]
    })
    .select('title amount category dateTime createdBy memberShares isPaid isSettled totalAmount groupId')
    .populate('createdBy', 'name')
    .populate('memberShares.user', 'name')
    .sort({ dateTime: -1 });

    if (limit > 0) {
      query = query.limit(limit);
    }

    const amounts = await query.lean();
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
        
        // Notify Leader
        const gId = updatedAmount.groupId || oldGroupId;
        if (gId) {
          await notifyGroupLeader(gId, req.user.id, 'EDIT', { 
            title: updatedAmount.title, 
            amount: updatedAmount.totalAmount || updatedAmount.amount 
          });
        }
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

      // Notify Leader
      await notifyGroupLeader(affectedGroupId, req.user.id, 'DELETE', { title: amount.title });
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

const getMemberTransactions = async (req, res) => {
  try {
    const { groupId, userId } = req.query;
    if (!groupId || !userId) return res.status(400).json({ message: 'groupId and userId are required' });

    const transactions = await Amount.find({
      groupId: groupId,
      $or: [
        { createdBy: userId },
        { 'memberShares.user': userId }
      ]
    })
    .populate('createdBy', 'name')
    .populate('memberShares.user', 'name')
    .sort({ dateTime: -1 })
    .lean();

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const settleMemberBalance = async (req, res) => {
  try {
    const { groupId, userId } = req.body;
    if (!groupId || !userId) return res.status(400).json({ message: 'groupId and userId are required' });

    // Capture the net balance before settling to log in history
    const amounts = await Amount.find({
      groupId,
      $or: [
        { createdBy: userId, isSettled: { $ne: true } },
        { 'memberShares.user': userId, 'memberShares.isSettled': { $ne: true } }
      ]
    }).lean();

    let totalPaidByUser = 0;
    let totalShareByUser = 0;

    amounts.forEach(amt => {
      if (amt.createdBy.toString() === userId.toString()) {
        totalPaidByUser += amt.totalAmount || amt.amount;
      }
      const myShare = amt.memberShares.find(s => s.user.toString() === userId.toString());
      if (myShare) totalShareByUser += myShare.amount;
    });

    const netEffect = totalPaidByUser - totalShareByUser;

    // Mark user's created amounts in this group as settled
    await Amount.updateMany(
      { groupId, createdBy: userId, isSettled: { $ne: true } },
      { $set: { isSettled: true } }
    );

    // Mark user's shares in this group as settled
    await Amount.updateMany(
      { groupId, 'memberShares.user': userId },
      { $set: { 'memberShares.$[elem].isSettled': true } },
      { arrayFilters: [{ 'elem.user': userId }] }
    );

    // Log in History
    const user = await User.findById(userId).select('name');
    await History.create({
      groupId,
      userId: req.user.id, // The leader who settled it
      type: 'SETTLE',
      amount: Math.abs(netEffect),
      title: `Member Settled: ${user?.name || 'User'}`
    });

    // Re-sync totals for the whole group (settling affects everyone's 'owed' status)
    const group = await Group.findById(groupId).select('members groupLeader');
    if (!group) return res.status(404).json({ message: 'Group not found' });
    
    const allMembers = [...group.members, group.groupLeader];
    
    await Promise.all([
      ...allMembers.map(m => syncUserTotal(m)),
      syncGroupTotal(groupId)
    ]);

    res.json({ message: 'Member balance settled successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMonthlyStatement = async (req, res) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const transactions = await Amount.find({
      $or: [
        { createdBy: req.user.id },
        { 'memberShares.user': req.user.id }
      ],
      dateTime: { $gte: startOfMonth, $lte: endOfMonth }
    })
    .populate('createdBy', 'name')
    .populate('groupId', 'name')
    .populate('memberShares.user', 'name')
    .sort({ dateTime: 1 })
    .lean();

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  addAmount, 
  getAmounts, 
  getAmountDetails, 
  editAmount, 
  deleteAmount, 
  syncUserTotal, 
  syncGroupTotal,
  getMemberTransactions,
  markAsPaid,
  settleMemberBalance,
  getMonthlyStatement
};
