const express = require('express');
const router = express.Router();
const { 
  createGroup, 
  updateGroup, 
  getGroups, 
  deleteGroup, 
  settleGroup, 
  getGroupHistory,
  addMember,
  removeMember
} = require('../controllers/groupController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').post(protect, createGroup).get(protect, getGroups);
router.route('/:id').put(protect, updateGroup).delete(protect, deleteGroup);
router.post('/:id/settle', protect, settleGroup);
router.get('/:id/history', protect, getGroupHistory);

// Member management
router.post('/:id/members', protect, addMember);
router.delete('/:id/members/:memberId', protect, removeMember);

module.exports = router;
