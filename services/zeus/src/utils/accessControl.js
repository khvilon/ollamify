export function isAdminUser(user) {
  if (!user) {
    return false;
  }

  if (user.is_admin === true || user.isAdmin === true) {
    return true;
  }

  return String(user.role || '').toLowerCase() === 'admin';
}

export function getAuthenticatedUserId(user) {
  const rawId = user?.id ?? user?.userId;
  const id = Number(rawId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function canAccessUserResource(user, targetUserId) {
  if (isAdminUser(user)) {
    return true;
  }

  const ownUserId = getAuthenticatedUserId(user);
  const target = Number(targetUserId);
  return ownUserId !== null && Number.isInteger(target) && ownUserId === target;
}

export function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

export function requireSelfOrAdmin(paramName = 'id') {
  return (req, res, next) => {
    if (!canAccessUserResource(req.user, req.params[paramName])) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  };
}
