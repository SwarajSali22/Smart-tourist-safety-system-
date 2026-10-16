import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.jsx';

/** Avatar button + dropdown with the signed-in user's details and Logout. */
function UserMenu({ user, onLogout }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('menu.account', { name: user?.name || '' })}
      >
        <span className="user-menu__avatar" aria-hidden="true">{initial}</span>
        <span className="user-menu__name">{user?.name}</span>
        <ChevronDown size={14} aria-hidden="true" className="user-menu__chevron" />
      </button>

      {open && (
        <div className="user-menu__panel" role="menu">
          <div className="user-menu__info">
            <strong>{user?.name}</strong>
            <span className="form-hint">{user?.email}</span>
            <span className="badge badge--info">{user?.role}</span>
          </div>
          <button type="button" role="menuitem" className="user-menu__item" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" /> {t('menu.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
