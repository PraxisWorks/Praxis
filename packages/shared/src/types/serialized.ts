/**
 * Converts Date fields to string in a type. Used to represent serialized
 * API responses where JSON serialization turns Date objects into ISO strings.
 *
 * @example
 * type SerializedRepo = Serialized<Repo>;
 * // { id: string; createdAt: string; updatedAt: string; ... }
 */
export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};
