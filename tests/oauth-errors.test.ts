import {it,expect} from 'vitest';
import {oauthError} from '../apps/web/src/oauth-errors';
it('gives actionable OAuth recovery and never reflects unknown error text',()=>{expect(oauthError('state_not_found')).toContain('same browser');expect(oauthError('account_not_linked')).toContain('password');expect(oauthError('email_does_not_match')).toContain('verified email');expect(oauthError('<script>secret</script>')).not.toContain('secret');expect(oauthError(null)).toBe('');});
