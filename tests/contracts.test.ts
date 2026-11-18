import { describe,it,expect } from 'vitest';
import { taskPatch, mayChange, invitationInput, linkInput, safeReturn, registerInput } from '../packages/contracts';
describe('validation and role invariants',()=>{
 it('preserves omitted task fields in partial updates',()=>{expect(taskPatch.parse({status:'DONE',expectedVersion:2})).toEqual({status:'DONE',expectedVersion:2});});
 it('blocks owner changes outside transfer',()=>{expect(mayChange('OWNER','OWNER','MEMBER')).toBe(false);expect(mayChange('ADMIN','MEMBER','ADMIN')).toBe(false);expect(mayChange('VIEWER','MEMBER','MEMBER')).toBe(false);});
 it('rejects open redirect paths',()=>{for(const path of ['https://evil.example','//evil.example','/\\evil','/join#bad'])expect(safeReturn(path)).toBe('/workspaces');expect(safeReturn('/join')).toBe('/join');});
 it('bounds invitation batches and join capacity',()=>{expect(invitationInput.safeParse({emails:Array(21).fill('x@example.com')}).success).toBe(false);expect(linkInput.safeParse({maxUses:0}).success).toBe(false);expect(linkInput.safeParse({days:31}).success).toBe(false);});
 it('requires a strong separate password and confirmation',()=>{expect(registerInput.safeParse({name:'Tester',email:'test@example.com',password:'short',confirmPassword:'short'}).success).toBe(false);});
});
