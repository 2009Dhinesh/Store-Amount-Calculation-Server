const Group = require('../models/Group');
const User = require('../models/User');
const Amount = require('../models/Amount');
const History = require('../models/History');
const { syncUserTotal, syncGroupTotal } = require('./amountController');

const createGroup = async (req, res) => {
  try {
    const { name, members } = req.body;
    const group = new Group({
      name,
      groupLeader: req.user.id,
      members: members || []
    });
    const createdGroup = await group.save();

    // Update group leader's groupId
    await User.findByIdAndUpdate(req.user.id, { groupId: createdGroup._id });
    
    // Update members' groupId
    if (members && members.length > 0) {
      await User.updateMany(
        { _id: { $in: members } },
        { $set: { groupId: createdGroup._id } }
      );
    }

    res.status(201).json(createdGroup);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (group.groupLeader.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const oldMembers = group.members.map(m => m.toString());
    group.name = req.body.name || group.name;
    group.monthlyLimit = req.body.monthlyLimit !== undefined ? req.body.monthlyLimit : group.monthlyLimit;
    group.notificationThreshold = req.body.notificationThreshold !== undefined ? req.body.notificationThreshold : group.notificationThreshold;
    
    if (req.body.members) {
      const newMembers = req.body.members;
      group.members = newMembers;

      // Members to be added (in new but not in old)
      const toAdd = newMembers.filter(m => !oldMembers.includes(m.toString()));
      // Members to be removed (in old but not in new)
      const toRemove = oldMembers.filter(m => !newMembers.map(nm => nm.toString()).includes(m));

      if (toAdd.length > 0) {
        await User.updateMany({ _id: { $in: toAdd } }, { $set: { groupId: group._id } });
      }
      if (toRemove.length > 0) {
        await User.updateMany({ _id: { $in: toRemove } }, { $set: { groupId: null } });
      }
    }

    const updatedGroup = await group.save();
    res.json(await updatedGroup.populate('members', 'name email'));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGroups = async (req, res) => {
  try {
    const { includeMember } = req.query;
    let query = { groupLeader: req.user.id };

    if (includeMember === 'true') {
      query = {
        $or: [
          { groupLeader: req.user.id },
          { members: req.user.id }
        ]
      };
    }

    const groups = await Group.find(query)
      .populate('members', 'name email')
      .populate('groupLeader', 'name email')
      .lean();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGroupDetails = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email')
      .populate('groupLeader', 'name email')
      .lean();
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.json(group);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (group.groupLeader.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Delete all Amount records linked to this group
    await Amount.deleteMany({ groupId: group._id });

    // Clear groupId for all members
    await User.updateMany(
      { groupId: group._id },
      { $set: { groupId: null } }
    );

    await group.deleteOne();
    res.json({ message: 'Group removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const settleGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (group.groupLeader.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    // Capture all member IDs of this group
    const memberIds = group.members.map(m => m.toString());
    if (!memberIds.includes(group.groupLeader.toString())) {
      memberIds.push(group.groupLeader.toString());
    }

    // Capture total before settling to log in history
    const totalBeforeSettle = group.totalAmount || 0;

    // Delete all Amount records linked to this group
    await Amount.deleteMany({ groupId: group._id });

    // Log a Settlement event in History
    await History.create({
      groupId: group._id,
      userId: req.user.id,
      type: 'SETTLE',
      amount: totalBeforeSettle,
      title: `Group Settle: ${group.name}`
    });

    // Reset group totalAmount
    group.totalAmount = 0;
    await group.save();

    // Re-sync all group members
    const syncs = memberIds.map(uid => syncUserTotal(uid));
    await Promise.all(syncs);

    res.json({ message: 'Group expenses settled and cleared' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGroupHistory = async (req, res) => {
  try {
    const { userId } = req.query;
    let query = { groupId: req.params.id };
    
    if (userId) {
      query.userId = userId;
    }

    const history = await History.find(query)
      .populate('userId', 'name')
      .sort({ timestamp: -1 })
      .lean();
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const addMember = async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (group.groupLeader.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    if (group.members.includes(userId)) {
      return res.status(400).json({ message: 'User already in group' });
    }

    group.members.push(userId);
    await group.save();

    await User.findByIdAndUpdate(userId, { groupId: group._id });

    res.json(await group.populate('members', 'name email'));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const removeMember = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (group.groupLeader.toString() !== req.user.id) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    group.members = group.members.filter(m => m.toString() !== req.params.memberId);
    await group.save();

    await User.findByIdAndUpdate(req.params.memberId, { groupId: null });

    res.json(await group.populate('members', 'name email'));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const calculateBalances = async (req, res) => {
  try {
    const groupId = req.params.id;
    const amounts = await Amount.find({ groupId }).populate('createdBy', 'name').lean();
    const group = await Group.findById(groupId).populate('members', 'name').populate('groupLeader', 'name').lean();

    if (!group) return res.status(404).json({ message: 'Group not found' });

    const allMemberIds = [group.groupLeader._id, ...group.members.map(m => m._id)];
    const balances = {};
    
    // Initialize balances
    allMemberIds.forEach(id => {
      balances[id.toString()] = { 
        id: id.toString(), 
        name: id.toString() === group.groupLeader._id.toString() ? group.groupLeader.name : group.members.find(m => m._id.toString() === id.toString()).name,
        paid: 0, 
        share: 0, 
        net: 0 
      };
    });

    amounts.forEach(amt => {
      const payerId = amt.createdBy._id.toString();
      if (balances[payerId]) {
        balances[payerId].paid += amt.totalAmount || amt.amount;
      }

      amt.memberShares.forEach(share => {
        const userId = share.user.toString();
        if (balances[userId]) {
          balances[userId].share += share.amount;
        }
      });
    });

    // Calculate net and format for frontend
    const result = Object.values(balances).map(b => {
      b.net = b.share; // Debt is purely based on Usage (Share)
      return b;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAIInsights = async (req, res) => {
  try {
    const groupId = req.params.id;
    const amounts = await Amount.find({ groupId }).lean();
    
    if (amounts.length === 0) {
      return res.json({ insights: ["Add some expenses to see AI insights!"] });
    }

    const categoryTotals = {};
    let grandTotal = 0;

    amounts.forEach(amt => {
      const cat = amt.category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt.amount;
      grandTotal += amt.amount;
    });

    const insights = [];
    const sortedCats = Object.keys(categoryTotals).sort((a, b) => categoryTotals[b] - categoryTotals[a]);

    // Percentage Breakdown
    const topCat = sortedCats[0];
    const topPercent = ((categoryTotals[topCat] / grandTotal) * 100).toFixed(1);
    insights.push(`You spend ${topPercent}% of the group budget on ${topCat}.`);

    if (topCat === 'Food' || topCat === 'Snacks') {
      insights.push(`Consider reducing ${topCat} expenses to save more this month.`);
    } else {
      insights.push(`Good job! Your spending on ${topCat} is the highest, keep an eye on it.`);
    }

    if (amounts.length > 10) {
      insights.push(`With ${amounts.length} transactions, you have a very active group budget!`);
    }

    res.json({ insights });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  createGroup, 
  updateGroup, 
  getGroups, 
  getGroupDetails,
  deleteGroup, 
  settleGroup, 
  getGroupHistory,
  addMember,
  removeMember,
  calculateBalances,
  getAIInsights
};
