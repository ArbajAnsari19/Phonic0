import { useEffect, useState } from 'react';
import { authApi } from '../lib/api';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(''); // read-only
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authApi.getProfile();
        setName(res.data.user.name);
        setEmail(res.data.user.email);
      } catch {
        toast.error('Failed to load profile');
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await authApi.updateProfile({ name });
      toast.success('Profile updated');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="text-2xl font-bold">Settings</div>
      <div className="card space-y-3">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Email</label>
          <input className="input" value={email} disabled />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}