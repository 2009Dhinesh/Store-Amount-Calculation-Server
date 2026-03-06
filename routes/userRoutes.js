const express = require('express');
const router = express.Router();
const { signupUser, loginUser, getUserProfile, getAllUsers, forgotPassword, resetPassword } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.post('/signup', signupUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/profile', protect, getUserProfile);
router.get('/', protect, getAllUsers);

module.exports = router;
