import {Temporal} from '@js-temporal/polyfill';
export function eventInstant(value:string,zone:string){return Temporal.PlainDateTime.from(value).toZonedDateTime(zone,{disambiguation:'reject'}).toInstant().toString();}
export function eventLocal(value:string|null,zone:string){return value?Temporal.Instant.from(value).toZonedDateTimeISO(zone).toPlainDateTime().toString().slice(0,16):'';}
