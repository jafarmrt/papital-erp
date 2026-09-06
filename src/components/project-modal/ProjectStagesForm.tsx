import React from 'react';
import { Workflow, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { WorkflowPreset } from '../../constants/presets';
import { ProjectStage } from './types';

interface ProjectStagesFormProps {
  stages: ProjectStage[];
  preset: string;
  availablePresets: WorkflowPreset[];
  onSelectPreset: (presetId: string) => void;
  onAddStage: () => void;
  onRemoveStage: (index: number) => void;
  onStageTitleChange: (index: number, newTitle: string) => void;
  onMoveStage: (index: number, direction: 'up' | 'down') => void;
}

export const ProjectStagesForm: React.FC<ProjectStagesFormProps> = ({
  stages,
  preset,
  availablePresets,
  onSelectPreset,
  onAddStage,
  onRemoveStage,
  onStageTitleChange,
  onMoveStage
}) => {
  return (
    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
          <Workflow size={14} className="text-blue-600" />
          فرآیند و مراحل گام‌به‌گام تولید ({stages.length} مرحله)
        </h3>
        
        {/* Preset Selector */}
        {availablePresets.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-2xs font-bold text-slate-500">الگوی آماده:</span>
            <select
              value={preset}
              onChange={(e) => onSelectPreset(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              {availablePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Dynamic Stages List */}
      <div className="space-y-2">
        {stages.map((stage, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs hover:border-slate-300 transition-all"
          >
            <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 font-mono text-xs font-bold flex items-center justify-center shrink-0">
              {idx + 1}
            </div>

            <input
              type="text"
              required
              value={stage.title}
              onChange={(e) => onStageTitleChange(idx, e.target.value)}
              placeholder={`عنوان مرحله ${idx + 1}`}
              className="flex-1 bg-transparent border-0 text-xs font-bold text-slate-800 focus:ring-0 p-1"
            />

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={idx === 0}
                onClick={() => onMoveStage(idx, 'up')}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                title="انتقال به بالا"
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                disabled={idx === stages.length - 1}
                onClick={() => onMoveStage(idx, 'down')}
                className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                title="انتقال به پایین"
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => onRemoveStage(idx)}
                className="p-1 text-red-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors cursor-pointer"
                title="حذف مرحله"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddStage}
        className="w-full border border-dashed border-slate-300 hover:border-blue-400 bg-white/50 hover:bg-blue-50/50 text-slate-600 hover:text-blue-600 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
      >
        <Plus size={14} />
        افزودن مرحله جدید به پایان فرآیند
      </button>
    </div>
  );
};
