import { UserID } from "./b-types";
import { Status } from "./c-types";

// Interfaces
export interface User {
  id: UserID;
  name: string;
  email: string;
  status: Status;
  profile?: Profile;
}

export interface Profile {
  bio: string;
  age: number;
  interests: string[];
}

// Enums
export enum Role {
  Admin = "ADMIN",
  User = "USER",
  Guest = "GUEST",
}

export default {};
