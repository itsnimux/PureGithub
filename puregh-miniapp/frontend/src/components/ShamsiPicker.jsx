import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import timePicker from 'react-multi-date-picker/plugins/time_picker';
const TimePicker = timePicker;

// Jalaali (Shamsi) date/time picker built on react-multi-date-picker.
// The backend stores publish_at as a UTC ISO instant; the picker itself shows
// a real Persian calendar (persian calendar + persian_fa locale) and hands the
// Gregorian UTC instant to onChange.

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export default function ShamsiPicker({ value, onChange }) {
  // Controlled value as a Date; default to ~30 minutes from now so there is
  // always a valid time to save without fiddling.
  const seed = value ? new Date(value) : new Date(Date.now() + 30 * 60 * 1000);

  return (
    <DatePicker
      calendar={persian}
      locale={persian_fa}
      value={seed}
      onChange={(date) => onChange(date ? date.toDate().toISOString() : null)}
      format="YYYY/MM/DD HH:mm"
      plugins={[<TimePicker hideSeconds position="bottom" />]}
      digits={FA_DIGITS}
      portal
      inputClass="input"
      containerClassName="shamsi-picker"
      placeholder="انتخاب زمان انتشار"
    />
  );
}