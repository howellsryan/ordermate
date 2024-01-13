using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;

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
        var query = "SELECT * FROM Categories WHERE CategoryId = @id";
        using var connection = _dbContext.CreateConnection();
        
        CategoryModel? category = await connection.QuerySingleOrDefaultAsync<CategoryModel>(query, new { id });
        return category;
    }

    public async Task<IEnumerable<CategoryModel?>> Get()
    {
        var query = "SELECT * FROM Categories";
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<CategoryModel> categories = await connection.QueryAsync<CategoryModel>(query);
        return categories;
    }
}