import { AuthConfig } from './types';

export class AuthRequiredError extends Error {
  public readonly name = 'AuthRequiredError';
  constructor(
    public readonly authKey: string,
    public readonly authConfig: AuthConfig,
    public readonly presentation: {
      schemeType: AuthConfig['authScheme']['type'];
      authorizationUrl?: string;
      scopes?: string[];
    }
  ) {
    super('Authentication required to call tool');
  }
}

