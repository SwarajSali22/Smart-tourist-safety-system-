const express = require('express');
const { listNotifications, markRead, markAllRead } = require('../controllers/notification.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { idParams, notificationListQuery } = require('../validation/schemas');

const router = express.Router();

router.use(authenticate); // any signed-in user; every handler is scoped to their own rows

router.get('/', validate(notificationListQuery, 'query'), listNotifications);
router.post('/read-all', markAllRead);
router.patch('/:id/read', validate(idParams, 'params'), markRead);

module.exports = router;
