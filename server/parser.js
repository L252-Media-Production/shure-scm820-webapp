const REP_PATTERN = /^< REP (\d+) (\w+) (.+) >$/;
const REP_GLOBAL_PATTERN = /^< REP ([A-Z][A-Z0-9_]*) (.+) >$/;
const SAMPLE_PATTERN = /^< SAMPLE ((?:\d{3} ?)+)>$/;
const GET_PATTERN = /^< GET (\d+) (\w+) >$/;
const GET_GLOBAL_PATTERN = /^< GET ([A-Z][A-Z0-9_]+) >$/;
const SET_PATTERN = /^< SET (\d+) (\w+) (.+) >$/;
const SET_GLOBAL_PATTERN = /^< SET ([A-Z][A-Z0-9_]+) (.+) >$/;

export function parse(raw) {
  const s = raw.trim();
  let m;
  if ((m = REP_PATTERN.exec(s))) return { type: 'REP', channel: +m[1], param: m[2], value: m[3] };
  if ((m = SAMPLE_PATTERN.exec(s))) return { type: 'SAMPLE', levels: m[1].trim().split(/\s+/).map(Number) };
  // No-channel REP (e.g. < REP DEVICE_ID {...} >, < REP METER_RATE 01000 >)
  if ((m = REP_GLOBAL_PATTERN.exec(s))) return { type: 'REP', channel: 0, param: m[1], value: m[2] };
  if ((m = GET_PATTERN.exec(s))) return { type: 'GET', channel: +m[1], param: m[2] };
  if ((m = GET_GLOBAL_PATTERN.exec(s))) return { type: 'GET', channel: null, param: m[1] };
  if ((m = SET_PATTERN.exec(s))) return { type: 'SET', channel: +m[1], param: m[2], value: m[3] };
  if ((m = SET_GLOBAL_PATTERN.exec(s))) return { type: 'SET', channel: null, param: m[1], value: m[2] };
  return { type: 'UNKNOWN', raw: s };
}

export function serializeGet(channel, param) {
  if (channel === null || channel === undefined) return `< GET ${param} >`;
  return `< GET ${channel} ${param} >`;
}

export function serializeSet(channel, param, value) {
  if (channel === null || channel === undefined) return `< SET ${param} ${value} >`;
  return `< SET ${channel} ${param} ${value} >`;
}

export function serializeRep(channel, param, value) {
  if (channel === null || channel === undefined) return `< REP ${param} ${value} >`;
  return `< REP ${channel} ${param} ${value} >`;
}

export function serializeSample(levels) {
  return `< SAMPLE ${levels.map((l) => String(l).padStart(3, '0')).join(' ')} >`;
}
