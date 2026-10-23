import type { Config } from 'tailwindcss';

/**
 * پنل مدیریت کارام — توکن‌های طراحی (هم‌خانواده با اپ اصلی، چیدمان چگال‌تر دسکتاپی)
 * رنگ برند: فیروزه‌ای تیره #00685f (قابل تعویض از این فایل)
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e6f4f2',
          100: '#c2e4e0',
          200: '#96d1cc',
          300: '#64bab4',
          400: '#3d9f99',
          500: '#26857f',
          600: '#00685f',
          700: '#005550',
          800: '#01433f',
          900: '#023633',
          950: '#012522',
        },
        surface: {
          light: '#f6faf9',
          dim: '#eef4f3',
        },
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06)',
        pop: '0 8px 24px rgba(16,24,40,.14)',
      },
    },
  },
  plugins: [],
} satisfies Config;
