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

    group.name = req.body.name || group.name;
    if (req.body.members) {
      group.members = req.body.members;
      // You may also want to update the Users' groupId references here
    }

    const updatedGroup = await group.save();
    res.json(updatedGroup);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGroups = async (req, res) => {
  try {
    const groups = await Group.find({ groupLeader: req.user.id }).populate('members', 'name email');
    res.json(groups);
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

    await group.remove();
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

    // Delete all Amount records linked to this group
    await Amount.deleteMany({ groupId: group._id });

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
    const history = await History.find({ groupId: req.params.id })
      .populate('userId', 'name')
      .sort({ timestamp: -1 });
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createGroup, updateGroup, getGroups, deleteGroup, settleGroup, getGroupHistory };
