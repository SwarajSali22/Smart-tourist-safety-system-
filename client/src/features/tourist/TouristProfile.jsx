import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// Loose international phone check: optional +, then 7–15 digits (spaces/dashes/brackets allowed).
const phoneOk = (p) => {
  const digits = String(p).replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(digits);
};

function TouristProfile() {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingContacts, setSavingContacts] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [itinerary, setItinerary] = useState([]);

  useEffect(() => {
    api.get('/tourists/me')
      .then((data) => {
        setGroupName(data.profile.group?.name || '');
        setContacts(data.profile.emergencyContacts || []);
        setItinerary((data.profile.itinerary || []).map((i) => ({ ...i, arrivalAt: toDateInput(i.arrivalAt), departureAt: toDateInput(i.departureAt) })));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const changeContact = (idx, field, value) => setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  const changeStop = (idx, field, value) => setItinerary((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

  async function saveContacts(e) {
    e.preventDefault();
    const bad = contacts.findIndex((c) => !phoneOk(c.phone));
    if (bad !== -1) {
      toast.error(t('profile.contacts.badPhone', { n: bad + 1 }));
      return;
    }
    setSavingContacts(true);
    try {
      await api.patch('/tourists/me/emergency-contacts', { emergencyContacts: contacts });
      toast.success(t('profile.contacts.saved'));
    } catch (err) {
      toast.error(err.message || t('profile.contacts.error'));
    } finally {
      setSavingContacts(false);
    }
  }

  async function saveItinerary(e) {
    e.preventDefault();
    for (const [i, s] of itinerary.entries()) {
      if (s.arrivalAt && s.departureAt && s.departureAt < s.arrivalAt) {
        toast.error(t('profile.trip.badDates', { n: i + 1 }));
        return;
      }
    }
    setSavingTrip(true);
    try {
      await api.patch('/tourists/me/itinerary', { itinerary });
      toast.success(t('profile.trip.saved'));
    } catch (err) {
      toast.error(err.message || t('profile.trip.error'));
    } finally {
      setSavingTrip(false);
    }
  }

  if (loading) return <div className="app-page"><SkeletonRows rows={6} /></div>;
  if (error) return <div className="app-page"><p className="form-error" role="alert">{error}</p></div>;

  return (
    <div className="app-page">
      <h1 className="page-title">{t('profile.title')}</h1>

      <Card title={t('profile.account')}>
        <dl className="profile-list">
          <div className="profile-field"><dt className="profile-field__label">{t('profile.name')}</dt><dd>{user?.name}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">{t('profile.email')}</dt><dd>{user?.email}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">{t('profile.phone')}</dt><dd>{user?.phone || '—'}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">{t('profile.role')}</dt><dd>{user?.role}</dd></div>
          {groupName && <div className="profile-field"><dt className="profile-field__label">Tour group</dt><dd>{groupName}</dd></div>}
        </dl>
      </Card>

      <Card title={t('profile.contacts.title')} className="mt-4">
        <form onSubmit={saveContacts}>
          <p className="form-hint">{t('profile.contacts.hint')}</p>
          {contacts.length === 0 && <p className="placeholder-text mt-4">{t('profile.contacts.none')}</p>}
          {contacts.map((c, idx) => (
            <div key={idx} className="contact-row">
              <input className="form-input" placeholder={t('profile.contacts.name')} aria-label={`${idx + 1} — ${t('profile.contacts.name')}`} value={c.name} onChange={(e) => changeContact(idx, 'name', e.target.value)} required />
              <input className="form-input" type="tel" placeholder={t('profile.contacts.phone')} aria-label={`${idx + 1} — ${t('profile.phone')}`} value={c.phone} onChange={(e) => changeContact(idx, 'phone', e.target.value)} required />
              <input className="form-input" placeholder={t('profile.contacts.relationship')} aria-label={`${idx + 1} — ${t('profile.contacts.relationship')}`} value={c.relationship || ''} onChange={(e) => changeContact(idx, 'relationship', e.target.value)} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setContacts((p) => p.filter((_, i) => i !== idx))} aria-label={`${t('common.remove')} ${idx + 1}`}>
                <Trash2 size={14} aria-hidden="true" /> {t('common.remove')}
              </button>
            </div>
          ))}
          <div className="contact-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setContacts((p) => [...p, { name: '', phone: '', relationship: '' }])}>
              <Plus size={14} aria-hidden="true" /> {t('profile.contacts.add')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={savingContacts}>{savingContacts ? t('common.saving') : t('profile.contacts.save')}</button>
          </div>
        </form>
      </Card>

      <Card title={t('profile.trip.title')} className="mt-4">
        <form onSubmit={saveItinerary}>
          <p className="form-hint">{t('profile.trip.hint')}</p>
          {itinerary.length === 0 && <p className="placeholder-text mt-4">{t('profile.trip.none')}</p>}
          {itinerary.map((s, idx) => (
            <div key={idx} className="contact-row">
              <input className="form-input" placeholder={t('profile.trip.destination')} aria-label={`${idx + 1} — ${t('profile.trip.destination')}`} value={s.destination || ''} onChange={(e) => changeStop(idx, 'destination', e.target.value)} required maxLength={120} />
              <label className="inline-field">{t('profile.trip.arrive')}
                <input className="form-input" type="date" value={s.arrivalAt} onChange={(e) => changeStop(idx, 'arrivalAt', e.target.value)} />
              </label>
              <label className="inline-field">{t('profile.trip.depart')}
                <input className="form-input" type="date" value={s.departureAt} min={s.arrivalAt || undefined} onChange={(e) => changeStop(idx, 'departureAt', e.target.value)} />
              </label>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setItinerary((p) => p.filter((_, i) => i !== idx))} aria-label={`${t('common.remove')} ${idx + 1}`}>
                <Trash2 size={14} aria-hidden="true" /> {t('common.remove')}
              </button>
            </div>
          ))}
          <div className="contact-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setItinerary((p) => [...p, { destination: '', arrivalAt: '', departureAt: '' }])}>
              <Plus size={14} aria-hidden="true" /> {t('profile.trip.add')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={savingTrip}>{savingTrip ? t('common.saving') : t('profile.trip.save')}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default TouristProfile;
