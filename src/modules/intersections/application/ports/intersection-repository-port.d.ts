export interface Intersection {
  NODE_ID: string;
  CRSRD_NM: string;
  SGNL_CRSRD_NM?: string;
}

export interface IntersectionRepositoryPort {
  findAll(): Promise<Intersection[]>;
  searchByName(term: string): Promise<Intersection[]>;
}

