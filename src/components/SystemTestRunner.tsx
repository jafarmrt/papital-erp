import React, { useState, useEffect } from 'react';
import { fetchJson } from '../api';
import { TestSuiteReport, TestLayer } from '../tests/types';
import {
  ShieldCheck, Play, RefreshCw, CheckCircle2, XCircle, Clock,
  Layers, Lock, Database, GitPullRequest, Zap, Cpu, Code2, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function SystemTestRunner() {
  const [report, setReport] = useState<TestSuiteReport | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [selectedLayer, setSelectedLayer] = useState<TestLayer | 'all'>('all');
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  const runTests = async (layer?: TestLayer | 'all') => {
    setRunning(true);
    try {
      const targetLayer = layer && layer !== 'all' ? layer : undefined;
      const url = targetLayer ? `/system/tests/run?layer=${targetLayer}` : '/system/tests/run';
      const data: TestSuiteReport = await fetchJson(url);
      setReport(data);
      if (data.overallStatus === 'passed') {
        toast.success(`تمامی ${data.passedCount} تست لایه‌ها با موفقیت پاس شدند.`);
      } else {
        toast.error(`تعداد ${data.failedCount} تست با خطا مواجه شد.`);
      }
    } catch (err) {
      toast.error(err.message || 'خطا در اجرای تست‌های سیستم');
    } finally {
      setRunning(false);
    }
  };

  // Note: Removed automatic execution on mount so opening tab doesn't trigger tests automatically

  const toggleExpand = (id: string) => {
    setExpandedCaseId(expandedCaseId === id ? null : id);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-500/20">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/20 border border-indigo-400/30 rounded-xl">
                <ShieldCheck className="w-7 h-7 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">آزمون‌های یکپارچگی سرتاسری E2E (Phase 21)</h2>
                <p className="text-slate-300 text-sm">ارزیابی ۸ لایه اصلی تست و ۱۵ سناریوی بحرانی سیستم ERP</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => runTests(selectedLayer)}
            disabled={running}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 cursor-pointer"
          >
            {running ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>در حال اجرای آزمون‌ها...</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>{report ? 'بازاجرای آزمون‌ها' : 'شروع و اجرای کامل آزمون‌ها'}</span>
              </>
            )}
          </button>
        </div>

        {/* Overall Statistics Summary */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6 pt-6 border-t border-slate-700/60">
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
              <span className="text-slate-400 text-xs block mb-1">وضعیت کل سیستم</span>
              <span className={`text-lg font-black uppercase ${
                report.overallStatus === 'passed' ? 'text-emerald-400' :
                report.overallStatus === 'failed' ? 'text-rose-400' :
                report.overallStatus === 'blocked' ? 'text-amber-400' : 'text-slate-400'
              }`}>
                {report.overallStatus || 'N/A'}
              </span>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
              <span className="text-slate-400 text-xs block mb-1">کل آزمون‌ها</span>
              <span className="text-2xl font-black text-white">{report.totalTests}</span>
            </div>
            <div className="bg-emerald-900/30 rounded-xl p-4 border border-emerald-500/30">
              <span className="text-emerald-300 text-xs block mb-1">موفق (Passed)</span>
              <span className="text-2xl font-black text-emerald-400">{report.passedCount}</span>
            </div>
            <div className="bg-rose-900/30 rounded-xl p-4 border border-rose-500/30">
              <span className="text-rose-300 text-xs block mb-1">ناموفق (Failed)</span>
              <span className="text-2xl font-black text-rose-400">{report.failedCount}</span>
            </div>
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
              <span className="text-slate-400 text-xs block mb-1">زمان کل اجرا</span>
              <span className="text-2xl font-black text-indigo-300">{report.totalDurationMs} ms</span>
            </div>
          </div>
        )}
      </div>

      {/* Initial Placeholder Before Running Tests */}
      {!report && !running && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-700 p-8 text-center space-y-4">
          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-2xl flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="font-bold text-slate-800 dark:text-white text-base">تست‌های یکپارچگی سیستم آماده اجرا</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
              جهت ارزیابی و پایش صحت عملکرد ۸ لایه اصلی و ۱۵ سناریوی بحرانی سیستم ERP، بر روی دکمه زیر کلیک نمایید.
            </p>
          </div>
          <button
            onClick={() => runTests(selectedLayer)}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer inline-flex items-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>شروع و اجرای آزمون‌های سیستم</span>
          </button>
        </div>
      )}

      {/* 15 Critical Scenarios Audit Grid */}
      {report && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-slate-800 text-lg">پایش ۱۵ سناریوی بحرانی (Critical Scenarios Audit)</h3>
            </div>
            <span className="text-xs bg-amber-50 text-amber-700 font-medium px-2.5 py-1 rounded-full border border-amber-200">
              پوشش ۱۰۰٪ سناریوهای فاز ۲۱
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.scenarioSummaries.map((scenario) => (
              <div
                key={scenario.scenarioId}
                className={`p-4 rounded-xl border transition-all ${
                  scenario.passed
                    ? 'bg-emerald-50/40 border-emerald-200/80 hover:border-emerald-300'
                    : 'bg-rose-50/40 border-rose-200/80 hover:border-rose-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                    {scenario.title}
                  </span>
                  {scenario.passed ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      PASSED
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                      <XCircle className="w-3.5 h-3.5" />
                      FAILED
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mb-2">{scenario.details}</p>
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-200/60 pt-2">
                  <span>مدت زمان اجرا:</span>
                  <span className="font-mono font-medium">{scenario.durationMs} ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Layer Filter Tabs & Case Breakdown */}
      {report && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              <span>تفکیک لایه‌های آزمون و نتایج جزئی</span>
            </h3>

            {/* Filter Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
              <button
                onClick={() => setSelectedLayer('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedLayer === 'all'
                    ? 'bg-slate-900 text-white shadow'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                همه لایه‌ها ({report.totalTests})
              </button>
              {report.layerSummaries.map((ls) => (
                <button
                  key={ls.layer}
                  onClick={() => setSelectedLayer(ls.layer)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedLayer === ls.layer
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {ls.label.split(' ')[0]} ({ls.passed}/{ls.total})
                </button>
              ))}
            </div>
          </div>

          {/* Test Cases Table / List */}
          <div className="space-y-3">
            {report.testCases
              .filter((tc) => selectedLayer === 'all' || tc.layer === selectedLayer)
              .map((tc) => {
                const isExpanded = expandedCaseId === tc.id;
                return (
                  <div
                    key={tc.id}
                    className={`border rounded-xl transition-all overflow-hidden ${
                      tc.passed ? 'border-slate-200 bg-white' : 'border-rose-200 bg-rose-50/20'
                    }`}
                  >
                    <div
                      onClick={() => toggleExpand(tc.id)}
                      className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {tc.passed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-800 text-sm">{tc.name}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 font-mono px-2 py-0.5 rounded">
                              {tc.layer.toUpperCase()}
                            </span>
                            {tc.executionType && (
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                tc.executionType === 'real_database' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                tc.executionType === 'real_api' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                'bg-amber-50 text-amber-700 border-amber-200'
                              }`}>
                                {tc.executionType === 'real_database' ? 'PostgreSQL DB' :
                                 tc.executionType === 'real_api' ? 'Real API' : 'Simulation'}
                              </span>
                            )}
                          </div>
                          {tc.details && (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{tc.details}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-400">{tc.durationMs} ms</span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 bg-slate-50 border-t border-slate-200/80 space-y-2 text-xs">
                        {tc.details && (
                          <div>
                            <span className="font-bold text-slate-700">توضیحات: </span>
                            <span className="text-slate-600">{tc.details}</span>
                          </div>
                        )}
                        {tc.error && (
                          <div className="p-3 bg-rose-100/60 border border-rose-200 rounded-lg text-rose-800 font-mono">
                            <span className="font-bold block mb-1">جزئیات خطا:</span>
                            {tc.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
