const express = require('express');
const router = express.Router();
const { 
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
} = require('../controllers/groupController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').post(protect, createGroup).get(protect, getGroups);
router.route('/:id').get(protect, getGroupDetails).put(protect, updateGroup).delete(protect, deleteGroup);
router.post('/:id/settle', protect, settleGroup);
router.get('/:id/history', protect, getGroupHistory);
router.get('/:id/balances', protect, calculateBalances);
router.get('/:id/insights', protect, getAIInsights);

// Member management
router.post('/:id/members', protect, addMember);
router.delete('/:id/members/:memberId', protect, removeMember);

module.exports = router;
