import { 
  composeValidations, 
  createPathValidator, 
  createContentFilter,
  createRateLimiter 
} from '../policies/validation.js';

describe('Validation Policies', () => {
  describe('composeValidations', () => {
    it('should pass when all validations pass', () => {
      const validator1 = () => ({ isValid: true as const });
      const validator2 = () => ({ isValid: true as const });
      
      const composed = composeValidations(validator1, validator2);
      const result = composed('test', {});
      
      expect(result.isValid).toBe(true);
    });

    it('should fail when any validation fails', () => {
      const validator1 = () => ({ isValid: true as const });
      const validator2 = () => ({ isValid: false as const, errorMessage: 'Failed' });
      
      const composed = composeValidations(validator1, validator2);
      const result = composed('test', {});
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errorMessage).toBe('Failed');
      }
    });
  });

  describe('createPathValidator', () => {
    const context = { permissions: ['admin'] };
    
    it('should allow paths in allowed list', () => {
      const validator = createPathValidator(['/shared', '/public']);
      const result = validator({ path: '/shared/file.txt' }, context);
      
      expect(result.isValid).toBe(true);
    });

    it('should deny paths not in allowed list', () => {
      const validator = createPathValidator(['/shared', '/public']);
      const result = validator({ path: '/private/file.txt' }, context);
      
      expect(result.isValid).toBe(false);
    });
  });

  describe('createContentFilter', () => {
    const filter = createContentFilter();

    it('should allow normal content', async () => {
      const result = await filter('This is normal content');
      expect(result.isValid).toBe(true);
    });

    it('should block sensitive content', async () => {
      const result = await filter('My password is 123456');
      expect(result.isValid).toBe(false);
    });
  });

  describe('createRateLimiter', () => {
    it('should allow calls within limit', async () => {
      const limiter = createRateLimiter(2, 1000, () => 'key');
      
      const result1 = await limiter('test1');
      const result2 = await limiter('test2');
      expect(result1.isValid).toBe(true);
      expect(result2.isValid).toBe(true);
    });

    it('should deny calls exceeding limit', async () => {
      const limiter = createRateLimiter(2, 1000, () => 'key');
      
      await limiter('test1');
      await limiter('test2');
      const result = await limiter('test3');
      
      expect(result.isValid).toBe(false);
    });
  });
});