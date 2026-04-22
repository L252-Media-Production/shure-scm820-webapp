const REP_PATTERN = /^< REP (\d+) (\w+) (.+) >$/;
const SAMPLE_PATTERN = /^< SAMPLE ((?:\d{3} ?)+)>$/;
const GET_PATTERN = /^< GET (\d+) (\w+) >$/;
const SET_PATTERN = /^< SET (\d+) (\w+) (.+) >$/;

export function parse(raw) {
  const s = raw.trim();
  let m;
  if ((m = REP_PATTERN.exec(s))) return { type: 'REP', channel: +m[1], param: m[2], value: m[3] };
  if ((m = SAMPLE_PATTERN.exec(s))) return { type: 'SAMPLE', levels: m[1].trim().split(/\s+/).map(Number) };
  if ((m = GET_PATTERN.exec(s))) return { type: 'GET', channel: +m[1], param: m[2] };
  if ((m = SET_PATTERN.exec(s))) return { type: 'SET', channel: +m[1], param: m[2], value: m[3] };
  return { type: 'UNKNOWN', raw: s };
}

export function serializeGet(channel, param) {
  return `< GET ${channel} ${param} >`;
}

export function serializeSet(channel, param, value) {
  return `< SET ${channel} ${param} ${value} >`;
}

export function serializeRep(channel, param, value) {
  return `< REP ${channel} ${param} ${value} >`;
}

export function serializeSample(levels) {
  return `< SAMPLE ${levels.map((l) => String(l).padStart(3, '0')).join(' ')} >`;
}
