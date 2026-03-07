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

module.exports = { 
  createGroup, 
  updateGroup, 
  getGroups, 
  deleteGroup, 
  settleGroup, 
  getGroupHistory,
  addMember,
  removeMember
};
