import {describe,it,expect} from 'vitest';
import {summarizeReviews} from '../apps/api/src/pull-review';
describe('GitHub review summaries',()=>{
 const r=(state:string,id:number,login='alice')=>({state,id,user:{login},submitted_at:'2026-10-22T12:00:00Z'});
 it('does not invent approval without reviews',()=>expect(summarizeReviews([])).toBe('NO_REVIEW'));
 it('uses latest decisive review per reviewer independent of input order',()=>expect(summarizeReviews([r('APPROVED',2),r('CHANGES_REQUESTED',1)])).toBe('APPROVED'));
 it('keeps other reviewers change requests visible',()=>expect(summarizeReviews([r('APPROVED',2),r('CHANGES_REQUESTED',1,'bob')])).toBe('CHANGES_REQUESTED'));
 it('handles dismissed and pending reviews without claiming approval',()=>expect(summarizeReviews([r('APPROVED',1),r('DISMISSED',2),{...r('APPROVED',3),submitted_at:null}])).toBe('NO_REVIEW'));
});
