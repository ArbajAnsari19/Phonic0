import { useEffect, useState } from 'react';
import {  brainApi } from '../lib/api';
import type { Brain } from '../lib/api';
import toast from 'react-hot-toast';

export default function BrainsPage() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', instructions: '' });

  const loadBrains = async () => {
    try {
      const res = await brainApi.getAll();
      setBrains(res.data.brains);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to load brains');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBrains(); }, []);

  const createBrain = async () => {
    try {
      if (!form.name || !form.instructions) {
        toast.error('Name and instructions are required');
        return;
      }
      await brainApi.create({ name: form.name, description: form.description, instructions: form.instructions, isActive: true });
      toast.success('Brain created');
      setShowModal(false);
      setForm({ name: '', description: '', instructions: '' });
      loadBrains();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to create brain');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">AI Brains</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>Create Brain</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : brains.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No brains yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brains.map((b) => (
            <div key={b._id} className="p-4 border border-gray-200 rounded-lg hover:border-primary-300 hover:shadow-sm transition-all">
              <div className="font-semibold text-lg text-gray-900">{b.name}</div>
              <div className="text-sm text-gray-600 mt-1">{b.description}</div>
              <div className="text-xs text-gray-400 mt-2">Updated {new Date(b.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-xl p-6 space-y-4 shadow-xl border border-gray-200">
            <div className="text-xl font-semibold">Create AI Brain</div>
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <textarea className="input" placeholder="Instructions" rows={8} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createBrain}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


