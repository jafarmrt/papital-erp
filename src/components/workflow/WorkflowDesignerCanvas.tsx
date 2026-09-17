import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { Plus, Save, Trash2, Clock, ArrowRight, Move, SlidersHorizontal } from 'lucide-react';
import { 
  useWorkflowDefinitionDetailQuery, 
  useSaveWorkflowDefinitionMutation,
  useUpdateCanvasPositionsMutation 
} from '../../hooks/queries/useWorkflowQueries';
import { toast } from 'react-hot-toast';

interface WorkflowDesignerCanvasProps {
  definitionId: number;
  onBack?: () => void;
}

interface CanvasNode {
  id?: number;
  stateKey: string;
  title: string;
  stateType: 'initial' | 'intermediate' | 'terminal';
  color: string;
  slaHours: number;
  positionX: number;
  positionY: number;
}

interface CanvasEdge {
  id?: number;
  fromStateKey: string;
  toStateKey: string;
  actionKey: string;
  title: string;
  requiredRole: string;
  approvalRuleType: string;
  kValue: number;
  ruleConditionsJson: any[];
  autoActionKey: string;
}

const STATE_COLORS: Record<string, { bg: string; border: string; text: string; header: string }> = {
  gray: { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-slate-300 dark:border-slate-600', text: 'text-slate-800 dark:text-slate-200', header: 'bg-slate-200 dark:bg-slate-700' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-900 dark:text-amber-200', header: 'bg-amber-200 dark:bg-amber-800' },
  sky: { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-300 dark:border-sky-700', text: 'text-sky-900 dark:text-sky-200', header: 'bg-sky-200 dark:bg-sky-800' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-300 dark:border-indigo-700', text: 'text-indigo-900 dark:text-indigo-200', header: 'bg-indigo-200 dark:bg-indigo-800' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-900 dark:text-emerald-200', header: 'bg-emerald-200 dark:bg-emerald-800' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-300 dark:border-rose-700', text: 'text-rose-900 dark:text-rose-200', header: 'bg-rose-200 dark:bg-rose-800' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-300 dark:border-purple-700', text: 'text-purple-900 dark:text-purple-200', header: 'bg-purple-200 dark:bg-purple-800' }
};

export const WorkflowDesignerCanvas: React.FC<WorkflowDesignerCanvasProps> = ({ definitionId, onBack }) => {
  const { data: detailData, isLoading, refetch } = useWorkflowDefinitionDetailQuery(definitionId);
  const saveMutation = useSaveWorkflowDefinitionMutation();
  const updatePositionsMutation = useUpdateCanvasPositionsMutation();

  const { data: dbRoles } = useQuery<{ id: number; name: string; code: string; isSystem?: number }[]>({
    queryKey: ['roles', 'list'],
    queryFn: async () => {
      const res = await fetchJson('/users/roles');
      return Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
    },
    staleTime: 5 * 60 * 1000
  });

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState<number | null>(null);

  const [defTitle, setDefTitle] = useState('');
  const [defEntityType, setDefEntityType] = useState('');
  const [defDescription, setDefDescription] = useState('');

  // Dragging state
  const [draggingNodeKey, setDraggingNodeKey] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // New Transition Modal
  const [showAddTransitionModal, setShowAddTransitionModal] = useState(false);
  const [newEdgeFrom, setNewEdgeFrom] = useState('');
  const [newEdgeTo, setNewEdgeTo] = useState('');

  useEffect(() => {
    const def = detailData?.definition || detailData;
    if (def && (detailData?.states || detailData?.transitions || def.id)) {
      setDefTitle(def.title || '');
      setDefEntityType(def.entityType || '');
      setDefDescription(def.description || '');

      const initialNodes: CanvasNode[] = (detailData.states || []).map((s: any, idx: number) => ({
        id: s.id,
        stateKey: s.stateKey,
        title: s.title,
        stateType: s.stateType || 'intermediate',
        color: s.color || 'gray',
        slaHours: Number(s.slaHours) || 24,
        positionX: Number(s.positionX) || (100 + (idx % 3) * 220),
        positionY: Number(s.positionY) || (100 + Math.floor(idx / 3) * 180)
      }));

      const stateIdToKeyMap = new Map<number | string, string>();
      initialNodes.forEach(n => {
        if (n.id) {
          stateIdToKeyMap.set(n.id, n.stateKey);
          stateIdToKeyMap.set(Number(n.id), n.stateKey);
          stateIdToKeyMap.set(String(n.id), n.stateKey);
        }
        stateIdToKeyMap.set(n.stateKey, n.stateKey);
      });

      const initialEdges: CanvasEdge[] = (detailData.transitions || []).map((t: any) => ({
        id: t.id,
        fromStateKey: stateIdToKeyMap.get(t.fromStateId) || t.fromStateKey || t.from || '',
        toStateKey: stateIdToKeyMap.get(t.toStateId) || t.toStateKey || t.to || '',
        actionKey: t.actionKey || 'action',
        title: t.title || 'اقدام',
        requiredRole: t.requiredRole || '',
        approvalRuleType: t.approvalRuleType || 'SINGLE',
        kValue: Number(t.kValue) || 1,
        ruleConditionsJson: t.ruleConditionsJson || [],
        autoActionKey: t.autoActionKey || ''
      }));

      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [detailData]);

  // Handle Dragging
  const handleMouseDownNode = (e: React.MouseEvent, stateKey: string) => {
    e.stopPropagation();
    setDraggingNodeKey(stateKey);
    const node = nodes.find(n => n.stateKey === stateKey);
    if (node && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - node.positionX,
        y: e.clientY - rect.top - node.positionY
      });
    }
  };

  const handleMouseMoveCanvas = (e: React.MouseEvent) => {
    if (!draggingNodeKey || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const newX = Math.max(10, Math.min(1100, e.clientX - rect.left - dragOffset.x));
    const newY = Math.max(10, Math.min(700, e.clientY - rect.top - dragOffset.y));

    setNodes(prev => prev.map(n => n.stateKey === draggingNodeKey ? { ...n, positionX: newX, positionY: newY } : n));
  };

  const handleMouseUpCanvas = () => {
    if (draggingNodeKey) {
      setDraggingNodeKey(null);
      // Auto update positions on backend
      const posArray = nodes.map(n => ({ id: n.id || 0, positionX: n.positionX, positionY: n.positionY })).filter(p => p.id > 0);
      if (posArray.length > 0) {
        updatePositionsMutation.mutate(posArray);
      }
    }
  };

  const handleAddNode = () => {
    const newKey = `state_${Date.now().toString().slice(-4)}`;
    const newNode: CanvasNode = {
      stateKey: newKey,
      title: 'وضعیت جدید',
      stateType: 'intermediate',
      color: 'sky',
      slaHours: 24,
      positionX: 150 + (nodes.length * 40) % 400,
      positionY: 150 + (nodes.length * 30) % 300
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNodeKey(newKey);
    setSelectedEdgeIndex(null);
  };

  const handleDeleteNode = (key: string) => {
    setNodes(prev => prev.filter(n => n.stateKey !== key));
    setEdges(prev => prev.filter(e => e.fromStateKey !== key && e.toStateKey !== key));
    if (selectedNodeKey === key) setSelectedNodeKey(null);
  };

  const handleAddEdgeSubmit = () => {
    if (!newEdgeFrom || !newEdgeTo) {
      toast.error('لطفاً مبدأ و مقصد انتقال را انتخاب نمایید');
      return;
    }
    const newEdge: CanvasEdge = {
      fromStateKey: newEdgeFrom,
      toStateKey: newEdgeTo,
      actionKey: `action_${Date.now().toString().slice(-4)}`,
      title: 'اقدام جدید',
      requiredRole: '',
      approvalRuleType: 'SINGLE',
      kValue: 1,
      ruleConditionsJson: [],
      autoActionKey: ''
    };
    setEdges(prev => [...prev, newEdge]);
    setShowAddTransitionModal(false);
    setSelectedEdgeIndex(edges.length);
    setSelectedNodeKey(null);
  };

  const def = detailData?.definition || detailData;

  const handleSaveAll = () => {
    if (!defTitle) {
      toast.error('عنوان ورکفلو الزامی است');
      return;
    }

    const payload = {
      id: definitionId,
      code: def?.code || `WORKFLOW_${definitionId}`,
      title: defTitle,
      entityType: defEntityType || def?.entityType || 'document',
      description: defDescription,
      states: nodes,
      transitions: edges
    };

    saveMutation.mutate(payload, {
      onSuccess: () => {
        refetch();
      }
    });
  };

  const selectedNode = nodes.find(n => n.stateKey === selectedNodeKey);
  const selectedEdge = selectedEdgeIndex !== null ? edges[selectedEdgeIndex] : null;

  if (isLoading) {
    return (
      <div className="p-12 text-center text-gray-500 dark:text-gray-400">
        در حال دریافت اطلاعات طراح ورکفلو...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={defTitle}
                onChange={e => setDefTitle(e.target.value)}
                className="font-bold text-lg text-gray-900 dark:text-white bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-indigo-500 focus:outline-none px-1"
                placeholder="عنوان ورکفلو..."
              />
              <span className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 rounded-full font-mono">
                کد: {def?.code}
              </span>
              <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                نسخه v{def?.version || 1}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              طراحی گرافیکی بوم، شروط JSON، زمان‌سنجی SLA و نقش‌های تاییدکننده
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAddNode}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>افزودن وضعیت (State)</span>
          </button>
          <button
            onClick={() => {
              if (nodes.length < 2) {
                toast.error('حداقل دو وضعیت برای ایجاد انتقال مورد نیاز است');
                return;
              }
              setNewEdgeFrom(nodes[0]?.stateKey || '');
              setNewEdgeTo(nodes[1]?.stateKey || '');
              setShowAddTransitionModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 rounded-lg transition-colors"
          >
            <Move className="w-4 h-4" />
            <span>اتصال جدید (Transition)</span>
          </button>
          <button
            onClick={handleSaveAll}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات الگو'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Visual Canvas + Sidebar Properties Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Interactive Canvas (3 Cols) */}
        <div 
          ref={canvasRef}
          onMouseMove={handleMouseMoveCanvas}
          onMouseUp={handleMouseUpCanvas}
          onClick={() => { setSelectedNodeKey(null); setSelectedEdgeIndex(null); }}
          className="lg:col-span-3 relative bg-slate-900/5 dark:bg-slate-950/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-800 min-h-[620px] overflow-hidden select-none p-4"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(156, 163, 175, 0.2) 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        >
          {/* SVG Connector Lines for Transitions */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
              </marker>
            </defs>
            {edges.map((edge, idx) => {
              const fromNode = nodes.find(n => n.stateKey === edge.fromStateKey);
              const toNode = nodes.find(n => n.stateKey === edge.toStateKey);
              if (!fromNode || !toNode) return null;

              // Calculate start and end centers
              const x1 = fromNode.positionX + 90;
              const y1 = fromNode.positionY + 45;
              const x2 = toNode.positionX + 90;
              const y2 = toNode.positionY + 45;

              const isSelected = selectedEdgeIndex === idx;

              // Midpoint for action label
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;

              return (
                <g key={idx} className="cursor-pointer pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSelectedEdgeIndex(idx); setSelectedNodeKey(null); }}>
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isSelected ? '#4f46e5' : '#94a3b8'}
                    strokeWidth={isSelected ? '3' : '2'}
                    strokeDasharray={edge.approvalRuleType !== 'SINGLE' ? '6,6' : undefined}
                    markerEnd="url(#arrowhead)"
                  />
                  <foreignObject x={mx - 55} y={my - 14} width="110" height="28">
                    <div className={`text-[10px] text-center px-1.5 py-0.5 rounded border shadow-xs truncate ${
                      isSelected 
                        ? 'bg-indigo-600 text-white border-indigo-700' 
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                    }`}>
                      {edge.title}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>

          {/* Draggable State Nodes */}
          {nodes.map(node => {
            const colorTheme = STATE_COLORS[node.color] || STATE_COLORS.gray;
            const isSelected = selectedNodeKey === node.stateKey;

            return (
              <div
                key={node.stateKey}
                onMouseDown={(e) => handleMouseDownNode(e, node.stateKey)}
                onClick={(e) => { e.stopPropagation(); setSelectedNodeKey(node.stateKey); setSelectedEdgeIndex(null); }}
                style={{ left: `${node.positionX}px`, top: `${node.positionY}px` }}
                className={`absolute w-44 rounded-xl border-2 shadow-sm transition-shadow cursor-grab active:cursor-grabbing z-10 ${colorTheme.bg} ${
                  isSelected ? 'border-indigo-600 ring-2 ring-indigo-500/30' : colorTheme.border
                }`}
              >
                {/* Node Header */}
                <div className={`px-3 py-1.5 rounded-t-lg flex items-center justify-between border-b ${colorTheme.header} ${colorTheme.border}`}>
                  <span className="text-[10px] font-mono font-bold text-gray-700 dark:text-gray-300">
                    {node.stateKey}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                    node.stateType === 'initial' ? 'bg-blue-600 text-white' : node.stateType === 'terminal' ? 'bg-emerald-600 text-white' : 'bg-gray-600 text-white'
                  }`}>
                    {node.stateType === 'initial' ? 'شروع' : node.stateType === 'terminal' ? 'پایان' : 'میانی'}
                  </span>
                </div>

                {/* Node Body */}
                <div className="p-3 space-y-2">
                  <p className={`font-bold text-xs ${colorTheme.text} truncate`}>{node.title}</p>
                  <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-700">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-500" />
                      SLA: {node.slaHours}h
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.stateKey); }}
                      className="text-gray-400 hover:text-rose-600 transition-colors"
                      title="حذف وضعیت"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sidebar Inspector Panel (1 Col) */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
          <div className="flex items-center justify-between border-b pb-2 border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>تنظیمات و جزئیات عنصر</span>
            </h3>
          </div>

          {/* Node Inspector */}
          {selectedNode ? (
            <div className="space-y-3">
              <div className="bg-indigo-50 dark:bg-indigo-950/40 p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800/60 text-xs text-indigo-900 dark:text-indigo-200">
                ویژگی‌های وضعیت <strong>{selectedNode.title}</strong>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">کد کلید وضعیت (Key)</label>
                <input
                  type="text"
                  value={selectedNode.stateKey}
                  onChange={(e) => {
                    const newKey = e.target.value;
                    setNodes(prev => prev.map(n => n.stateKey === selectedNodeKey ? { ...n, stateKey: newKey } : n));
                    setSelectedNodeKey(newKey);
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان نمایش</label>
                <input
                  type="text"
                  value={selectedNode.title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.stateKey === selectedNodeKey ? { ...n, title: val } : n));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">نوع وضعیت</label>
                <select
                  value={selectedNode.stateType}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setNodes(prev => prev.map(n => n.stateKey === selectedNodeKey ? { ...n, stateType: val } : n));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="initial">شروع (Initial)</option>
                  <option value="intermediate">میانی (Intermediate)</option>
                  <option value="terminal">پایانی (Terminal)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">رنگ تم گرافیکی</label>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(STATE_COLORS).map(c => (
                    <button
                      key={c}
                      onClick={() => setNodes(prev => prev.map(n => n.stateKey === selectedNodeKey ? { ...n, color: c } : n))}
                      className={`w-6 h-6 rounded-full border-2 ${selectedNode.color === c ? 'border-black dark:border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c === 'sky' ? '#38bdf8' : c === 'amber' ? '#fbbf24' : c === 'emerald' ? '#34d399' : c === 'rose' ? '#f43f5e' : c === 'purple' ? '#c084fc' : c === 'indigo' ? '#818cf8' : '#94a3b8' }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">حداکثر زمان مجاز SLA (ساعت)</label>
                <input
                  type="number"
                  value={selectedNode.slaHours}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setNodes(prev => prev.map(n => n.stateKey === selectedNodeKey ? { ...n, slaHours: val } : n));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          ) : selectedEdge ? (
            /* Edge / Transition Inspector */
            <div className="space-y-3">
              <div className="bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200">
                تنظیمات اقدام (Transition): <strong>{selectedEdge.title}</strong>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان اکشن</label>
                <input
                  type="text"
                  value={selectedEdge.title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, title: val } : eg));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">کد کلید اکشن (ActionKey)</label>
                <input
                  type="text"
                  value={selectedEdge.actionKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, actionKey: val } : eg));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">نقش مجاز تاییدکننده</label>
                <select
                  value={selectedEdge.requiredRole}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, requiredRole: val } : eg));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">همه کاربران (بدون محدودیت نقش)</option>
                  {dbRoles && dbRoles.length > 0 ? (
                    dbRoles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name} ({r.code})
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="admin">مدیر سیستم (admin)</option>
                      <option value="warehouse_keeper">انباردار (warehouse_keeper)</option>
                      <option value="accountant">حسابدار (accountant)</option>
                      <option value="sales_manager">مدیر فروش (sales_manager)</option>
                      <option value="production_manager">مدیر تولید (production_manager)</option>
                    </>
                  )}
                  {selectedEdge.requiredRole && 
                   (!dbRoles || !dbRoles.some(r => r.code === selectedEdge.requiredRole)) && (
                    <option value={selectedEdge.requiredRole}>
                      نقش سفارشی یا قبلی: {selectedEdge.requiredRole}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">منطق تاییدات موازی</label>
                <select
                  value={selectedEdge.approvalRuleType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, approvalRuleType: val } : eg));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="SINGLE">تک‌امضا (SINGLE - یک نفر)</option>
                  <option value="AND_ALL">چندامضایی اجباری / اتفاق آرا (AND_ALL - همه اعضا)</option>
                  <option value="OR_ANY">اولین تایید / حداقل یک نفر (OR_ANY - هریک از اعضا)</option>
                  <option value="K_OF_N">تایید حد نصاب (K_OF_N - حداقل K نفر از N نفر)</option>
                </select>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {selectedEdge.approvalRuleType === 'AND_ALL' && 'تمام اعضای گروه یا نقش موظفند امضا ثبت کنند تا انتقال نهایی شود.'}
                  {selectedEdge.approvalRuleType === 'OR_ANY' && 'به محض ثبت اولین تایید توسط هریک از اعضای مجاز، وضعیت بلافاصله تغییر می‌یابد.'}
                  {selectedEdge.approvalRuleType === 'K_OF_N' && 'تعداد حداقل K امضا برای عبور از این گام مورد نیاز است.'}
                  {selectedEdge.approvalRuleType === 'SINGLE' && 'یک تایید تکی برای تغییر وضعیت کافی است.'}
                </p>
              </div>

              {(selectedEdge.approvalRuleType === 'AND_ALL' || selectedEdge.approvalRuleType === 'K_OF_N') && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">تعداد امضاهای مورد نیاز (K Value)</label>
                  <input
                    type="number"
                    min="1"
                    value={selectedEdge.kValue}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 1;
                      setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, kValue: val } : eg));
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">اکشن اتوماتیک سیستمی (Auto Action)</label>
                <select
                  value={selectedEdge.autoActionKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEdges(prev => prev.map((eg, idx) => idx === selectedEdgeIndex ? { ...eg, autoActionKey: val } : eg));
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono"
                >
                  <option value="">بدون اکشن خودکار</option>
                  <option value="POST_INVOICE">ثبت نهایی و کسر انبار فاکتور (POST_INVOICE)</option>
                  <option value="APPROVE_PENDING_MATERIAL">تایید و انتقال به کاتالوگ مواد (APPROVE_PENDING_MATERIAL)</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setEdges(prev => prev.filter((_, idx) => idx !== selectedEdgeIndex));
                  setSelectedEdgeIndex(null);
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 rounded-lg transition-colors mt-4"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف این اتصال (Transition)</span>
              </button>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-xs">
              روی یکی از وضعیت‌ها (Nodes) یا اتصال‌ها (Transitions) در بوم کلیک کنید تا ویژگی‌های آن قابل ویرایش شود.
            </div>
          )}
        </div>
      </div>

      {/* Add Transition Modal */}
      {showAddTransitionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl border border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-white text-base">افزودن اتصال جدید (Transition)</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت مبدأ (From State)</label>
                <select
                  value={newEdgeFrom}
                  onChange={e => setNewEdgeFrom(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {nodes.map(n => (
                    <option key={n.stateKey} value={n.stateKey}>{n.title} ({n.stateKey})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت مقصد (To State)</label>
                <select
                  value={newEdgeTo}
                  onChange={e => setNewEdgeTo(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {nodes.map(n => (
                    <option key={n.stateKey} value={n.stateKey}>{n.title} ({n.stateKey})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowAddTransitionModal(false)}
                className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                انصراف
              </button>
              <button
                onClick={handleAddEdgeSubmit}
                className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                ایجاد اتصال
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
