// Timezone (IANA tz database) dataset for the organization profile form.
// Uses Intl.supportedValuesOf('timeZone') where available (Node 18.14+/modern
// browsers); a curated static list is the fallback so the picker always works.

export interface TimezoneOption {
  /** IANA time zone id, e.g. 'Africa/Cairo' */
  id: string;
  /** Display label, e.g. 'Africa/Cairo (GMT+02:00)' */
  label: string;
}

/** Static fallback list of common IANA zones. */
const FALLBACK_TIMEZONES: readonly string[] = [
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Lima',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'America/Vancouver',
  'Asia/Baghdad',
  'Asia/Bangkok',
  'Asia/Beirut',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Istanbul',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kuala_Lumpur',
  'Asia/Manila',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Australia/Brisbane',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Dublin',
  'Europe/Helsinki',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

let cachedTimezones: readonly string[] | null = null;

function listTimezones(): readonly string[] {
  if (cachedTimezones !== null) return cachedTimezones;
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      const zones = Intl.supportedValuesOf('timeZone');
      if (zones.length > 0) {
        cachedTimezones = zones;
        return cachedTimezones;
      }
    } catch {
      // fall through to the static list
    }
  }
  cachedTimezones = FALLBACK_TIMEZONES;
  return cachedTimezones;
}

let offsetFormatter: Intl.DateTimeFormat | null = null;

function formatOffset(id: string, at: Date): string {
  try {
    if (offsetFormatter === null) {
      offsetFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    // Wall-clock time in the target zone for the same instant.
    const zoneParts = new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .reduce<Record<string, string>>((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});

    const utcParts = offsetFormatter.formatToParts(at).reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

    const zoneMin = Date.UTC(
      Number(zoneParts.year),
      Number(zoneParts.month) - 1,
      Number(zoneParts.day),
      Number(zoneParts.hour),
      Number(zoneParts.minute),
      Number(zoneParts.second),
    );
    const utcMin = Date.UTC(
      Number(utcParts.year),
      Number(utcParts.month) - 1,
      Number(utcParts.day),
      Number(utcParts.hour),
      Number(utcParts.minute),
      Number(utcParts.second),
    );
    const diffMin = Math.round((zoneMin - utcMin) / 60000);
    const sign = diffMin < 0 ? '-' : '+';
    const abs = Math.abs(diffMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  } catch {
    return '';
  }
}

/** All timezones sorted by offset then id, each with a readable label. */
export function getTimezones(at: Date = new Date()): TimezoneOption[] {
  return listTimezones()
    .map((id) => {
      const offset = formatOffset(id, at);
      return { id, label: offset ? `${id} (GMT${offset})` : id };
    })
    .sort((a, b) => {
      const aOffset = extractOffsetMinutes(a.label);
      const bOffset = extractOffsetMinutes(b.label);
      if (aOffset !== bOffset) return aOffset - bOffset;
      return a.id.localeCompare(b.id);
    });
}

function extractOffsetMinutes(label: string): number {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}
