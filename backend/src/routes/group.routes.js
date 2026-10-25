const express = require('express');
const { z } = require('zod');
const { listGroups, createGroup, createInvitation, revokeInvitation, previewInvitation, joinGroup, listMembers } = require('../controllers/group.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { registerLimiter } = require('../middleware/rateLimits');
const { idParams } = require('../validation/schemas');

const groupCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });
const inviteCreateSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional(),
  maxUses: z.number().int().min(1).max(500).optional(),
});

// Staff only (admin). There is no separate "guide" role in STS; a guide is a staff admin account.
const staff = express.Router();
staff.use(authenticate, authorize('admin'));
staff.get('/', listGroups);
staff.post('/', validate(groupCreateSchema), createGroup);
staff.get('/:id/members', validate(idParams, 'params'), listMembers);
staff.post('/:id/invitations', validate(idParams, 'params'), validate(inviteCreateSchema), createInvitation);
staff.delete('/invitations/:id', validate(idParams, 'params'), revokeInvitation);

const publicRouter = express.Router();
publicRouter.get('/:token', registerLimiter, previewInvitation);
publicRouter.post('/:token/join', registerLimiter, authenticate, authorize('tourist'), joinGroup);

module.exports = { staff, publicRouter };
