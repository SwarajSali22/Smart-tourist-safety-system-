import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// Loose international phone check: optional +, then 7–15 digits (spaces/dashes/brackets allowed).
const phoneOk = (p) => {
  const digits = String(p).replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(digits);
};

function TouristProfile() {
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingContacts, setSavingContacts] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [itinerary, setItinerary] = useState([]);

  useEffect(() => {
    api.get('/tourists/me')
      .then((data) => {
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
      toast.error(`Contact ${bad + 1}: enter a valid phone number with country code, e.g. +91 98765 43210.`);
      return;
    }
    setSavingContacts(true);
    try {
      await api.patch('/tourists/me/emergency-contacts', { emergencyContacts: contacts });
      toast.success('Emergency contacts saved. They will be texted if you press SOS.');
    } catch (err) {
      toast.error(err.message || 'Could not save contacts');
    } finally {
      setSavingContacts(false);
    }
  }

  async function saveItinerary(e) {
    e.preventDefault();
    for (const [i, s] of itinerary.entries()) {
      if (s.arrivalAt && s.departureAt && s.departureAt < s.arrivalAt) {
        toast.error(`Stop ${i + 1}: departure is before arrival.`);
        return;
      }
    }
    setSavingTrip(true);
    try {
      await api.patch('/tourists/me/itinerary', { itinerary });
      toast.success('Itinerary saved.');
    } catch (err) {
      toast.error(err.message || 'Could not save itinerary');
    } finally {
      setSavingTrip(false);
    }
  }

  if (loading) return <div className="tourist-page"><SkeletonRows rows={6} /></div>;
  if (error) return <div className="tourist-page"><p className="form-error" role="alert">{error}</p></div>;

  return (
    <div className="tourist-page">
      <h1 className="page-title">My profile</h1>

      <Card title="Account details">
        <dl className="profile-list">
          <div className="profile-field"><dt className="profile-field__label">Name</dt><dd>{user?.name}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">Email</dt><dd>{user?.email}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">Phone</dt><dd>{user?.phone || '—'}</dd></div>
          <div className="profile-field"><dt className="profile-field__label">Role</dt><dd>{user?.role}</dd></div>
        </dl>
      </Card>

      <Card title="Emergency contacts" className="mt-4">
        <form onSubmit={saveContacts}>
          <p className="form-hint">These people are texted your last location if you press SOS (when SMS alerts are enabled).</p>
          {contacts.length === 0 && <p className="placeholder-text mt-4">No emergency contacts added yet.</p>}
          {contacts.map((c, idx) => (
            <div key={idx} className="contact-row">
              <input className="form-input" placeholder="Name" aria-label={`Contact ${idx + 1} name`} value={c.name} onChange={(e) => changeContact(idx, 'name', e.target.value)} required />
              <input className="form-input" type="tel" placeholder="+91 98765 43210" aria-label={`Contact ${idx + 1} phone`} value={c.phone} onChange={(e) => changeContact(idx, 'phone', e.target.value)} required />
              <input className="form-input" placeholder="Relationship (optional)" aria-label={`Contact ${idx + 1} relationship`} value={c.relationship || ''} onChange={(e) => changeContact(idx, 'relationship', e.target.value)} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setContacts((p) => p.filter((_, i) => i !== idx))} aria-label={`Remove contact ${idx + 1}`}>
                <Trash2 size={14} aria-hidden="true" /> Remove
              </button>
            </div>
          ))}
          <div className="contact-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setContacts((p) => [...p, { name: '', phone: '', relationship: '' }])}>
              <Plus size={14} aria-hidden="true" /> Add contact
            </button>
            <button type="submit" className="btn btn--primary" disabled={savingContacts}>{savingContacts ? 'Saving…' : 'Save contacts'}</button>
          </div>
        </form>
      </Card>

      <Card title="Itinerary" className="mt-4">
        <form onSubmit={saveItinerary}>
          <p className="form-hint">Planned stops help admins understand where you should be.</p>
          {itinerary.length === 0 && <p className="placeholder-text mt-4">No stops added yet.</p>}
          {itinerary.map((s, idx) => (
            <div key={idx} className="contact-row">
              <input className="form-input" placeholder="Destination" aria-label={`Stop ${idx + 1} destination`} value={s.destination || ''} onChange={(e) => changeStop(idx, 'destination', e.target.value)} required maxLength={120} />
              <label className="inline-field">Arrive
                <input className="form-input" type="date" value={s.arrivalAt} onChange={(e) => changeStop(idx, 'arrivalAt', e.target.value)} />
              </label>
              <label className="inline-field">Depart
                <input className="form-input" type="date" value={s.departureAt} min={s.arrivalAt || undefined} onChange={(e) => changeStop(idx, 'departureAt', e.target.value)} />
              </label>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setItinerary((p) => p.filter((_, i) => i !== idx))} aria-label={`Remove stop ${idx + 1}`}>
                <Trash2 size={14} aria-hidden="true" /> Remove
              </button>
            </div>
          ))}
          <div className="contact-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setItinerary((p) => [...p, { destination: '', arrivalAt: '', departureAt: '' }])}>
              <Plus size={14} aria-hidden="true" /> Add stop
            </button>
            <button type="submit" className="btn btn--primary" disabled={savingTrip}>{savingTrip ? 'Saving…' : 'Save itinerary'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default TouristProfile;
