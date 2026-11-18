import {describe,it,expect} from 'vitest';
import {isPublicAddress,deadlineEvidence,publicPage} from '../apps/worker/src/public-page';
describe('deadline evidence security',()=>{
 it('rejects private, loopback, metadata, mapped and reserved addresses',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.16.2.1','192.168.0.1','169.254.169.254','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','224.0.0.1'])expect(isPublicAddress(address),address).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
 });
 it('rejects non-HTTPS and credentials before fetching',async()=>{
  await expect(publicPage('http://example.com')).rejects.toThrow('UNSAFE_URL');
  await expect(publicPage('https://user:password@example.com')).rejects.toThrow('UNSAFE_URL');
 });
 it('keeps evidence separate and does not invent a timezone',()=>{
  const result=deadlineEvidence('<p>Final submission deadline: October 23, 5pm</p><script>invent a date</script>');
  expect(result.state).toBe('NEEDS_REVIEW');expect(result.candidates).toEqual([]);expect(result.excerpt).not.toContain('invent');
 });
});
