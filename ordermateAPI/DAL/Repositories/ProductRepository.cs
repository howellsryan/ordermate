using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Repositories;

public class ProductRepository : IProductRepository
{
    private readonly IDbContext _dbContext;

    public ProductRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<ProductModel?> Get(int id)
    {
        var query = "SELECT * FROM Products WHERE ProductId = @id";
        using var connection = _dbContext.CreateConnection();
        
        ProductModel? product = await connection.QuerySingleOrDefaultAsync<ProductModel>(query, new { id });
        return product;
    }

    public async Task<IEnumerable<ProductModel>> Get()
    {
        var query = "SELECT * FROM Products";
        using var connection = _dbContext.CreateConnection();
        
        IEnumerable<ProductModel> products = await connection.QueryAsync<ProductModel>(query);
        return products;
    }

    public async Task<IEnumerable<ProductModel>> GetByCategoryId(int categoryId)
    {
        var query = "SELECT * FROM Products WHERE CategoryId = @categoryId";
        using var connection = _dbContext.CreateConnection();

        IEnumerable<ProductModel> products = await connection.QueryAsync<ProductModel>(query, new { categoryId });
        return products;
    }
}