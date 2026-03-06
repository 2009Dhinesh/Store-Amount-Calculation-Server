const express = require('express');
const router = express.Router();
const { createGroup, updateGroup, getGroups, deleteGroup, settleGroup, getGroupHistory } = require('../controllers/groupController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').post(protect, createGroup).get(protect, getGroups);
router.route('/:id').put(protect, updateGroup).delete(protect, deleteGroup);
router.post('/:id/settle', protect, settleGroup);
router.get('/:id/history', protect, getGroupHistory);

module.exports = router;
