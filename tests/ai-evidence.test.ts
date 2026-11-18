import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {aiResult,contextOptions} from '../apps/api/src/ai-contracts';
import {checkEvidence,providerTokenCount} from '../apps/api/src/ai-evidence';
const cases=JSON.parse(readFileSync('tests/fixtures/ai-evaluation.json','utf8'));
describe('AI evidence evaluation fixtures',()=>{
 for(const item of cases)it(item.id,()=>{const evidence=checkEvidence(item.sources,item.fixture.citations,[],item.fixture.answer);expect(evidence.accepted).toBe(item.expected.accepted);if(item.expected.accepted){for(const term of item.expected.contains)expect(item.fixture.answer.toLowerCase()).toContain(term.toLowerCase());for(const term of item.expected.excludes)expect(item.fixture.answer).not.toContain(term);}});
 it('does not treat absent citations as 100 percent verified',()=>expect(checkEvidence([],[],[]).validity).toBeNull());
 it('rejects unbacked answer markers and blank evidence',()=>{expect(checkEvidence([],[],[],'Claim [S1]').accepted).toBe(false);expect(checkEvidence(cases[0].sources,[{sourceId:'S1',quote:' '}],[]).accepted).toBe(false);});
 it('preserves exact source metadata and excludes uncited source text',()=>{const r=checkEvidence(cases[0].sources,cases[0].fixture.citations,[]);expect(r.references[0].title).toBe('Synthetic project brief');expect(r.references[0]).not.toHaveProperty('text');});
 it('validates provider token counts without inventing usage',()=>{expect(providerTokenCount(undefined)).toBeUndefined();expect(providerTokenCount(-1)).toBeUndefined();expect(providerTokenCount(12)).toBe(12);});
 it('keeps every structured-output field required and rejects extra context keys',()=>{const schema=z.toJSONSchema(aiResult) as any;expect(schema.required).toContain('citations');expect(contextOptions.safeParse({otherWorkspace:true}).success).toBe(false);});
});
