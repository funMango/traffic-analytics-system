'use strict';

const { BadRequestError } = require('../../../../shared/domain/errors/http-errors');

function createSearchIntersectionsUseCase({ intersectionRepository }) {
  return async function searchIntersections(rawTerm) {
    const term = String(rawTerm || '').trim();
    if (!term) {
      throw new BadRequestError('검색어를 입력하세요');
    }
    return intersectionRepository.searchByName(term);
  };
}

module.exports = {
  createSearchIntersectionsUseCase,
};

