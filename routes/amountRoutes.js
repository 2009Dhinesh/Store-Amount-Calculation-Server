const express = require('express');
const router = express.Router();
const { addAmount, getAmounts, getAmountDetails, editAmount, deleteAmount, markAsPaid } = require('../controllers/amountController');
const { protect } = require('../middleware/authMiddleware');

router.route('/').post(protect, addAmount).get(protect, getAmounts);
router.route('/:id').get(protect, getAmountDetails).put(protect, editAmount).delete(protect, deleteAmount);
router.patch('/:id/paid', protect, markAsPaid);

module.exports = router;
