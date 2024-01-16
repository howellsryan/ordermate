using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class CategoryRepository : ICategoryRepository
{
    private readonly IDbContext _dbContext;

    public CategoryRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<CategoryModel?> Get(int id)
    {
        using var connection = _dbContext.CreateConnection();
        
        CategoryModel? category = await connection.QuerySingleOrDefaultAsync<CategoryModel>(CategoryScripts.GetByCategoryId, new { id });
        return category;
    }

    public async Task<IEnumerable<CategoryModel?>> Get()
    {
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<CategoryModel> categories = await connection.QueryAsync<CategoryModel>(CategoryScripts.Get);
        return categories;
    }
}