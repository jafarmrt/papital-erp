import { useEffect, useRef, useState } from 'react';
import {
  BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip, type ChartConfiguration,
} from 'chart.js';
import { formatPersianNumber } from '../../../utils';
import { chartHeight } from './chartHeight';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۶): نمودار میله‌ای «گزارش‌های مدیریتی» با Chart.js. فقط از
 * `LazyReportBarChart` بار می‌شود، پس کتابخانه در تکه جدا `vendor-charts` است و کاربری که صفحه گزارش را باز نکند آن را
 * دانلود نمی‌کند (`vite.config.ts`).
 *
 * یک سری، یک رنگ (بی راهنما؛ عنوان نمودار نام سری است)، راست‌به‌چپ: در نمودار ستونی نخستین دوره در راست و محور مبلغ در
 * راست، در نمودار افقی برچسب‌ها در راست و میله‌ها رو به چپ. محور با عدد فارسی کوتاه («۱۲٫۵ میلیون») و راهنمای روی میله با
 * مبلغ کامل. رنگ‌ها برای سطح روشن و تیره جدا سنجیده شده‌اند و با تغییر حالت سامانه عوض می‌شوند.
 */

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface ReportChartBar {
  label: string;
  /** عدد در واحد نمایش */
  value: number;
  /** متن کامل مبلغ برای راهنمای میله */
  text: string;
  /** سهم از جمع، درصد */
  percent?: number | null;
}

export interface ReportBarChartProps {
  /** نام سری و برچسب دسترسی‌پذیری نمودار */
  title: string;
  bars: ReportChartBar[];
  orientation: 'vertical' | 'horizontal';
}

/** رنگ‌های سنجیده نمودار (سری نخست آبی، خط شبکه و متن کم‌رنگ)؛ روشن و تیره */
const THEMES = {
  light: { bar: '#2a78d6', hover: '#1c5cab', grid: '#e2e8f0', text: '#52514e', tooltipBg: '#0f172a', tooltipText: '#f8fafc' },
  dark: { bar: '#3987e5', hover: '#6da7ec', grid: '#334155', text: '#c3c2b7', tooltipBg: '#f8fafc', tooltipText: '#0f172a' },
} as const;

const DARK_QUERY = '(prefers-color-scheme: dark)';
const FONT_FAMILY = 'Vazirmatn, Tahoma, sans-serif';
const compact = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });

function useDarkScheme(): boolean {
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** متن جایگزین نمودار برای صفحه‌خوان: هر میله با مبلغ کاملش */
export function chartAltText(title: string, bars: ReportChartBar[]): string {
  return `${title}: ${bars.map(b => `${b.label} ${b.text}`).join('، ')}`;
}

export function ReportBarChart({ title, bars, orientation }: ReportBarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dark = useDarkScheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const theme = dark ? THEMES.dark : THEMES.light;
    const horizontal = orientation === 'horizontal';
    const valueAxis = {
      reverse: horizontal,
      position: horizontal ? 'bottom' as const : 'right' as const,
      beginAtZero: true,
      grid: { color: theme.grid },
      border: { display: false },
      ticks: { color: theme.text, font: { family: FONT_FAMILY, size: 11 }, callback: (v: string | number) => compact.format(Number(v)) },
    };
    const labelAxis = {
      reverse: !horizontal,
      position: horizontal ? 'right' as const : 'bottom' as const,
      grid: { display: false },
      border: { color: theme.grid },
      ticks: { color: theme.text, font: { family: FONT_FAMILY, size: 11 }, autoSkip: !horizontal },
    };
    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: bars.map(b => b.label),
        datasets: [{
          label: title,
          data: bars.map(b => b.value),
          backgroundColor: theme.bar,
          hoverBackgroundColor: theme.hover,
          borderRadius: 4,
          borderSkipped: 'start',
          categoryPercentage: 0.8,
          barPercentage: 0.9,
          maxBarThickness: 36,
        }],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        locale: 'fa-IR',
        interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
        plugins: {
          legend: { display: false },
          tooltip: {
            rtl: true,
            textDirection: 'rtl',
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            displayColors: false,
            titleFont: { family: FONT_FAMILY, weight: 'bold' },
            bodyFont: { family: FONT_FAMILY },
            callbacks: {
              label: ctx => {
                const bar = bars[ctx.dataIndex];
                if (!bar) return '';
                return bar.percent === null || bar.percent === undefined ? bar.text : `${bar.text} (${formatPersianNumber(bar.percent, 1)}٪)`;
              },
            },
          },
        },
      },
    };
    const chart = new Chart(canvas, config);
    return () => chart.destroy();
  }, [bars, dark, orientation, title]);

  return (
    <div style={{ height: chartHeight(orientation, bars.length) }} className="relative w-full">
      <canvas ref={canvasRef} role="img" aria-label={chartAltText(title, bars)} />
    </div>
  );
}
