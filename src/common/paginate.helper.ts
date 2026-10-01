import { Repository, FindOptionsWhere, FindOptionsRelations, FindOptionsOrder } from 'typeorm';
import { PaginationDto } from './pagination.dto';

export async function paginate<T>(
  repository: Repository<T>,
  pagination: PaginationDto,
  where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  relations?: FindOptionsRelations<T>,
  order?: FindOptionsOrder<T>,
) {
  const { page = 1, limit = 10 } = pagination;
  const skip = (page - 1) * limit;

  const [data, total] = await repository.findAndCount({
    where,
    relations,
    order,
    skip,
    take: limit,
  });

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
