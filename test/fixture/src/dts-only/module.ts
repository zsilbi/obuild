import { Role, User } from "./a-types"; // No extension
import { UserID } from "./b-types.js"; // .js extension
import { Status } from "./c-types.ts"; // .ts extension

// Classes
export class UserManager {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: UserID): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  getAllUsers(): User[] {
    return this.users;
  }
}

// Functions
export function createUser(
  name: string,
  email: string,
  status: Status = "pending",
): User {
  return {
    id: Math.random().toString(36).substr(2, 9),
    name,
    email,
    status,
  };
}

export function isActive(user: User): boolean {
  return user.status === "active";
}

// Constants
export const DEFAULT_STATUS: Status = "pending";
export const ROLES: Role[] = [Role.Admin, Role.User, Role.Guest];

// Generic type
export type ApiResponse<T> = {
  data: T;
  error?: string;
};

// Exporting a namespace
export namespace Utils {
  export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  export function isEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
