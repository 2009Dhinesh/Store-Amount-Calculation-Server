const express = require('express');
const router = express.Router();
const { addAmount, getAmounts, getAmountDetails, editAmount, deleteAmount, markAsPaid, getMemberTransactions, settleMemberBalance, getMonthlyStatement } = require('../controllers/amountController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, addAmount);
router.get('/', protect, getAmounts);
router.get('/statement', protect, getMonthlyStatement);
router.get('/member', protect, getMemberTransactions);
router.post('/settle', protect, settleMemberBalance);
router.route('/:id').get(protect, getAmountDetails).put(protect, editAmount).delete(protect, deleteAmount);
router.patch('/:id/paid', protect, markAsPaid);

module.exports = router;
