const express = require('express');
const router = express.Router();
const { signupUser, loginUser, getUserProfile, getAllUsers } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.post('/signup', signupUser);
router.post('/login', loginUser);
router.get('/profile', protect, getUserProfile);
router.get('/', protect, getAllUsers);

module.exports = router;
